import { Prisma, PrismaClient, ReminderChannel } from '@prisma/client';
import { DateTime } from 'luxon';
import { manageToken, manageTokenHash, manageUrl } from '../common/manage-token';
import { readSettings } from '../common/tenant-settings';
import { sms } from '../notify/sms';
import { InlineButton, telegram } from '../notify/telegram';
import { smsText, telegramText } from './messages';

const MAX_ATTEMPTS = 3;
const BACKOFF_MIN = [1, 5, 15];

type Outcome =
  | { status: 'SENT'; channel: ReminderChannel }
  | { status: 'CANCELLED' | 'FAILED'; error: string }
  | { status: 'RETRY'; error: string };

export function bookingButtons(bookingId: string, status: string, url: string): InlineButton[][] {
  const row: InlineButton[] = [];
  if (status === 'SCHEDULED') row.push({ text: '✅ Подтвердить', callback_data: `c:${bookingId}` });
  row.push({ text: '❌ Отменить', callback_data: `x:${bookingId}` });
  return [row, [{ text: 'Открыть запись', url }]];
}

/**
 * Отправить все созревшие напоминания. Безопасно запускать в нескольких воркерах:
 * строки «арендуются» через FOR UPDATE SKIP LOCKED и сдвиг scheduledAt на 5 минут.
 */
export async function processDueReminders(db: PrismaClient, now = new Date()): Promise<{ sent: number; failed: number; cancelled: number }> {
  const claimed = await db.$queryRaw<{ id: string }[]>`
    UPDATE "Reminder" SET attempts = attempts + 1, "scheduledAt" = ${new Date(+now + 5 * 60_000)}
    WHERE id IN (
      SELECT id FROM "Reminder"
      WHERE status = 'PENDING' AND "scheduledAt" <= ${now}
      ORDER BY "scheduledAt" LIMIT 50
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  const stats = { sent: 0, failed: 0, cancelled: 0 };

  for (const { id } of claimed) {
    let outcome: Outcome;
    try {
      outcome = await processOne(db, id, now);
    } catch (e) {
      outcome = { status: 'RETRY', error: (e as Error).message };
    }
    const r = await db.reminder.findUniqueOrThrow({ where: { id } });
    const data: Prisma.ReminderUpdateInput =
      outcome.status === 'SENT'
        ? { status: 'SENT', channel: outcome.channel, sentAt: now, lastError: null }
        : outcome.status === 'RETRY' && r.attempts < MAX_ATTEMPTS
          ? { status: 'PENDING', lastError: outcome.error, scheduledAt: new Date(+now + BACKOFF_MIN[r.attempts - 1] * 60_000) }
          : { status: outcome.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED', lastError: outcome.error };
    await db.reminder.update({ where: { id }, data });
    if (outcome.status === 'SENT') stats.sent++;
    else if (outcome.status === 'CANCELLED') stats.cancelled++;
    else if (data.status === 'FAILED') stats.failed++;
  }
  return stats;
}

async function processOne(db: PrismaClient, id: string, now: Date): Promise<Outcome> {
  const r = await db.reminder.findUniqueOrThrow({
    where: { id },
    include: {
      booking: {
        include: { customer: true, resource: { select: { name: true } }, items: { orderBy: { sortOrder: 'asc' }, select: { name: true } } },
      },
    },
  });
  const b = r.booking;
  if (!['SCHEDULED', 'CONFIRMED'].includes(b.status)) return { status: 'CANCELLED', error: `booking ${b.status}` };
  if (b.startsAt <= now) return { status: 'CANCELLED', error: 'too late' };

  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: b.tenantId } });
  if (!readSettings(tenant.settings).remindersEnabled) return { status: 'CANCELLED', error: 'reminders disabled' };

  // Записи, созданные до появления HMAC-токенов, получают хэш при первой отправке.
  if (!b.manageTokenHash) await db.booking.update({ where: { id: b.id }, data: { manageTokenHash: manageTokenHash(b.id) } });

  const url = manageUrl(tenant.slug, b.id);
  const ctx = {
    type: r.type, startsAt: b.startsAt, tz: tenant.timezone, url,
    salon: { name: tenant.name, address: tenant.address, phone: tenant.phone },
    services: b.items.map((i) => i.name), master: b.resource.name, customerName: b.customer.name,
  };

  // 1) Telegram — бесплатно и с кнопками
  if (b.customer.telegramChatId && telegram.enabled) {
    const res = await telegram.send(b.customer.telegramChatId, telegramText(ctx, now), bookingButtons(b.id, b.status, url));
    if (res.ok) return { status: 'SENT', channel: 'TELEGRAM' };
    if (res.blocked) {
      await db.customer.update({ where: { id: b.customerId }, data: { telegramChatId: null } });
    } else {
      return { status: 'RETRY', error: `telegram: ${res.error}` };
    }
  }

  // 2) SMS — платно, поэтому: только если клиент ещё не подтвердил визит (для 2-часового) и в пределах лимита тарифа
  if (!sms.enabled) return { status: 'FAILED', error: 'no channel: telegram not linked, sms not configured' };
  if (r.type === 'BEFORE_2H' && b.status === 'CONFIRMED') return { status: 'CANCELLED', error: 'already confirmed, sms skipped' };

  const sub = await db.subscription.findUnique({ where: { tenantId: b.tenantId }, include: { plan: true } });
  const limit = Number((sub?.plan.limits as { smsPerMonth?: number } | null)?.smsPerMonth ?? 0);
  const monthStart = DateTime.fromJSDate(now, { zone: tenant.timezone }).startOf('month').toJSDate();
  const used = await db.reminder.count({ where: { tenantId: b.tenantId, channel: 'SMS', status: 'SENT', sentAt: { gte: monthStart } } });
  if (used >= limit) return { status: 'FAILED', error: `sms limit reached (${used}/${limit})` };

  const res = await sms.send(b.customer.phone, smsText(ctx, now));
  return res.ok ? { status: 'SENT', channel: 'SMS' } : { status: 'RETRY', error: `sms: ${res.error}` };
}

export { manageToken };
