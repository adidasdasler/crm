/**
 * Лист ожидания. Клиент выбрал день, а свободного времени нет — оставляет заявку.
 * Воркер раз в несколько минут проверяет заявки: как только у мастера появилось окно
 * (кто-то отменил или перенёс запись, мастер открыл время), клиенту уходит письмо со ссылкой,
 * а салону — уведомление с именем и телефоном, чтобы можно было позвонить.
 */
import type { PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';
import { BookingsService } from '../bookings/bookings.service';
import { env } from '../config';
import { DEMO_SLUG } from '../demo/demo';
import { mailer } from '../notify/mailer';
import { notifyStaff } from '../notify/staff';
import { esc } from '../notify/telegram';

export const MAX_WAITLIST_PER_PHONE = 3;
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Ссылка «записаться» прямо на нужный день, с выбранными услугами и мастером */
export const waitlistBookUrl = (slug: string, e: { serviceIds: string[]; resourceId: string | null; date: Date }) =>
  `${env.PUBLIC_WEB_URL}/b/${slug}?s=${e.serviceIds.join(',')}${e.resourceId ? `&m=${e.resourceId}` : ''}&d=${isoDate(e.date)}`;

/**
 * app — клиент с ролью приложения (RLS): свободное время считаем строго внутри салона.
 * system — для выборки заявок по всем салонам и уведомлений.
 */
export async function waitlistTick(app: PrismaClient, system: PrismaClient, now = new Date()) {
  const bookings = new BookingsService();
  const stats = { notified: 0, expired: 0 };
  const entries = await system.waitlistEntry.findMany({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, take: 500 });
  const tenants = new Map<string, { id: string; slug: string; name: string; timezone: string; settings: unknown; deletedAt: Date | null } | null>();

  for (const e of entries) {
    if (!tenants.has(e.tenantId)) tenants.set(e.tenantId, await system.tenant.findUnique({ where: { id: e.tenantId }, select: { id: true, slug: true, name: true, timezone: true, settings: true, deletedAt: true } }));
    const t = tenants.get(e.tenantId);
    const date = isoDate(e.date);
    const today = DateTime.fromJSDate(now).setZone(t?.timezone ?? 'Europe/Moscow').toISODate()!;
    if (!t || t.deletedAt || date < today) {
      await system.waitlistEntry.update({ where: { id: e.id }, data: { status: 'EXPIRED' } });
      stats.expired++;
      continue;
    }
    const free = await app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${t.id}, true)`;
      return bookings.slots(tx, t, { date, serviceIds: e.serviceIds, resourceId: e.resourceId, onlyPublic: true });
    });
    const first = free.flatMap((r) => r.slots).sort()[0];
    if (!first) continue;

    // Сначала отмечаем, потом шлём: лучше не отправить, чем отправить дважды
    const claimed = await system.waitlistEntry.updateMany({ where: { id: e.id, status: 'ACTIVE' }, data: { status: 'NOTIFIED', notifiedAt: now } });
    if (!claimed.count) continue;
    stats.notified++;
    if (t.slug === DEMO_SLUG) continue;

    const when = DateTime.fromISO(first).setZone(t.timezone).setLocale('ru').toFormat("d MMMM, HH:mm");
    const url = waitlistBookUrl(t.slug, e);
    if (e.email) {
      await mailer.send({
        to: e.email,
        subject: `Освободилось время — ${t.name}`,
        text: `Здравствуйте, ${e.name}!\n\nВ «${t.name}» освободилось время: ${when}. Успейте записаться — окно могут занять:\n${url}\n\nВы получили письмо, потому что попросили сообщить о свободном времени.`,
      }).catch(() => null);
    }
    await notifyStaff(system, t.id, `⏳ <b>Лист ожидания</b>: освободилось ${esc(when)}\n${esc(e.name)}, ${esc(e.phone)} ждёт окно${e.email ? ' — письмо отправлено' : ' — позвоните клиенту'}`, {
      resourceId: e.resourceId ?? undefined,
      push: { title: 'Лист ожидания: освободилось время', body: `${when} — клиент ждёт окно`, data: { route: '/' } },
    });
  }
  return stats;
}
