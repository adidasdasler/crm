/**
 * Возврат клиентов. Пишем ТОЛЬКО тем, кто дал согласие на рассылку (38-ФЗ «О рекламе», ст. 18),
 * и только через каналы, которые клиент сам подключил (Telegram, MAX, ВКонтакте, email).
 * В каждом сообщении — ссылка «отписаться». Отправка днём, с 11 до 20 по времени салона.
 *  - «Давно не были»: через N дней после последнего визита, если нет будущих записей. Один раз за «паузу».
 *  - День рождения: в сам день, раз в год.
 */
import type { Customer, PrismaClient } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { DateTime } from 'luxon';
import { env } from '../config';
import { readSettings } from '../common/tenant-settings';
import { DEMO_SLUG } from '../demo/demo';
import { CHANNELS } from '../notify/channels';
import { CUSTOMER_FIELD } from '../reminders/process';
import { esc } from '../notify/telegram';

const BATCH = 100;

const unsubKey = () => createHmac('sha256', env.JWT_SECRET).update('salon:unsubscribe:v1').digest();
export const unsubscribeSig = (customerId: string) => createHmac('sha256', unsubKey()).update(customerId).digest('base64url').slice(0, 22);
export const unsubscribeUrl = (customerId: string) => `${env.API_PUBLIC_URL ?? `${env.PUBLIC_WEB_URL}/v1`}/unsubscribe/${customerId}/${unsubscribeSig(customerId)}`;

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const fill = (tpl: string, c: { name: string }, salon: string) => tpl.replace(/\{имя\}/gi, firstName(c.name)).replace(/\{салон\}/gi, salon);

export const DEFAULT_WINBACK = '{имя}, давно не виделись! В «{салон}» будем рады видеть вас снова — выберите удобное время онлайн.';
export const DEFAULT_BIRTHDAY = '{имя}, с днём рождения! Команда «{салон}» желает вам радости и красоты. Ждём в гости!';

async function deliver(db: PrismaClient, c: Customer, text: string, bookUrl: string, subject: string) {
  // Ссылки обычным текстом: так они видны и в письме, и в мессенджерах
  const html = `${esc(text)}\n\nЗаписаться онлайн: ${bookUrl}\n\n<i>Не хотите получать такие сообщения? Отписаться: ${unsubscribeUrl(c.id)}</i>`;
  for (const ch of CHANNELS) {
    const field = CUSTOMER_FIELD[ch.name];
    const to = c[field];
    if (!to || !ch.enabled()) continue;
    // Кнопка «Записаться» — в мессенджерах; в письме ссылка уже есть в тексте
    const r = await ch.send(to, html, ch.name === 'EMAIL' ? undefined : [[{ text: 'Записаться', url: bookUrl }]], subject);
    if (r.ok) return ch.name;
    if (r.blocked) await db.customer.update({ where: { id: c.id }, data: { [field]: null } });
  }
  return null;
}

export async function winbackTick(db: PrismaClient, now = new Date()) {
  const stats = { winback: 0, birthday: 0 };
  const tenants = await db.tenant.findMany({
    where: { deletedAt: null, slug: { not: DEMO_SLUG }, subscription: { status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] } } },
    select: { id: true, slug: true, name: true, timezone: true, settings: true },
  });
  for (const t of tenants) {
    const s = readSettings(t.settings);
    if (!s.winbackEnabled && !s.birthdayEnabled) continue;
    const local = DateTime.fromJSDate(now).setZone(t.timezone);
    if (local.hour < 11 || local.hour >= 20) continue;
    const bookUrl = `${env.PUBLIC_WEB_URL}/b/${t.slug}?src=winback`;
    const reachable = { OR: [{ telegramChatId: { not: null } }, { maxUserId: { not: null } }, { vkUserId: { not: null } }, { email: { not: null } }] };

    if (s.winbackEnabled) {
      const before = local.minus({ days: s.winbackDays }).toJSDate();
      const list = await db.customer.findMany({
        where: {
          tenantId: t.id, deletedAt: null, marketingConsent: true, ...reachable,
          lastVisitAt: { lt: before },
          // Один раз за «паузу»: после последнего визита ещё не писали
          OR: [{ lastWinbackAt: null }, { lastWinbackAt: { lt: db.customer.fields.lastVisitAt } }],
          bookings: { none: { startsAt: { gt: now }, status: { in: ['SCHEDULED', 'CONFIRMED'] } } },
        },
        take: BATCH,
      });
      for (const c of list) {
        await db.customer.update({ where: { id: c.id }, data: { lastWinbackAt: now } });
        if (await deliver(db, c, fill(s.winbackText || DEFAULT_WINBACK, c, t.name), bookUrl, `Ждём вас снова — ${t.name}`)) stats.winback++;
      }
    }

    if (s.birthdayEnabled) {
      const yearStart = local.startOf('year').toJSDate();
      const md = local.toFormat('MM-dd');
      const list = await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Customer"
        WHERE "tenantId" = ${t.id}::uuid AND "deletedAt" IS NULL AND "marketingConsent" AND "birthDate" IS NOT NULL
          AND to_char("birthDate", 'MM-DD') = ${md}
          AND ("lastBirthdayAt" IS NULL OR "lastBirthdayAt" < ${yearStart})
        LIMIT ${BATCH}`;
      for (const { id } of list) {
        const c = await db.customer.update({ where: { id }, data: { lastBirthdayAt: now } });
        if (await deliver(db, c, fill(s.birthdayText || DEFAULT_BIRTHDAY, c, t.name), bookUrl, `С днём рождения! — ${t.name}`)) stats.birthday++;
      }
    }
  }
  return stats;
}
