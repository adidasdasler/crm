import { Prisma, PrismaClient, ReminderChannel } from '@prisma/client';
import { manageToken, manageTokenHash, manageUrl } from '../common/manage-token';
import { readSettings } from '../common/tenant-settings';
import { Button, CHANNELS, ChannelName } from '../notify/channels';
import { feedbackButtons, feedbackText } from '../reviews/reviews';
import { telegramText } from './messages';

const MAX_ATTEMPTS = 3;
const BACKOFF_MIN = [1, 5, 15];

type Outcome =
  | { status: 'SENT'; channel: ReminderChannel }
  | { status: 'CANCELLED' | 'FAILED'; error: string }
  | { status: 'RETRY'; error: string };

/** Кнопки под напоминанием — одинаковые для Telegram, MAX и VK (в письме — ссылка). */
export function bookingButtons(bookingId: string, status: string, url: string): Button[][] {
  const row: Button[] = [];
  if (status === 'SCHEDULED') row.push({ text: '✅ Подтвердить', data: `c:${bookingId}` });
  row.push({ text: '❌ Отменить', data: `x:${bookingId}` });
  return [row, [{ text: 'Открыть запись', url }]];
}

/** Где у клиента хранится адрес в каждом канале */
export const CUSTOMER_FIELD: Record<ChannelName, 'telegramChatId' | 'maxUserId' | 'vkUserId' | 'email'> = {
  TELEGRAM: 'telegramChatId', MAX: 'maxUserId', VK: 'vkUserId', EMAIL: 'email',
};

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
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: b.tenantId } });
  const feedback = r.type === 'AFTER_VISIT';
  if (feedback) {
    if (b.status !== 'COMPLETED') return { status: 'CANCELLED', error: `booking ${b.status}` };
    if (!readSettings(tenant.settings).feedbackEnabled) return { status: 'CANCELLED', error: 'feedback disabled' };
    if (await db.review.findUnique({ where: { bookingId: b.id }, select: { id: true } })) return { status: 'CANCELLED', error: 'already rated' };
    if (+now - +b.endsAt > 2 * 86400_000) return { status: 'CANCELLED', error: 'too late' };
  } else {
    if (!['SCHEDULED', 'CONFIRMED'].includes(b.status)) return { status: 'CANCELLED', error: `booking ${b.status}` };
    if (b.startsAt <= now) return { status: 'CANCELLED', error: 'too late' };
    if (!readSettings(tenant.settings).remindersEnabled) return { status: 'CANCELLED', error: 'reminders disabled' };
  }

  // Записи, созданные до появления HMAC-токенов, получают хэш при первой отправке.
  if (!b.manageTokenHash) await db.booking.update({ where: { id: b.id }, data: { manageTokenHash: manageTokenHash(b.id) } });

  const url = manageUrl(tenant.slug, b.id);
  const services = b.items.map((i) => i.name);
  const html = feedback
    ? feedbackText({ salon: tenant.name, services, master: b.resource.name })
    : telegramText({
      type: r.type, startsAt: b.startsAt, tz: tenant.timezone, url,
      salon: { name: tenant.name, address: tenant.address, phone: tenant.phone },
      services, master: b.resource.name, customerName: b.customer.name,
    }, now);
  const buttons = feedback ? feedbackButtons(b.id, url) : bookingButtons(b.id, b.status, url);

  // Telegram → MAX → ВКонтакте → Email: первый канал, который подключил клиент и который настроен у нас.
  const errors: string[] = [];
  let tried = false;
  for (const ch of CHANNELS) {
    const field = CUSTOMER_FIELD[ch.name];
    const to = b.customer[field];
    if (!to || !ch.enabled()) continue;
    tried = true;
    const res = await ch.send(to, html, buttons, feedback ? `Как прошёл визит в «${tenant.name}»?` : `Напоминание: ${tenant.name}`);
    if (res.ok) return { status: 'SENT', channel: ch.name as ReminderChannel };
    errors.push(`${ch.name}: ${res.error}`);
    // Клиент заблокировал бота/запретил сообщения — отвязываем канал и пробуем следующий
    if (res.blocked) await db.customer.update({ where: { id: b.customerId }, data: { [field]: null } });
  }
  if (!tried) return { status: 'FAILED', error: 'no channel: клиент не подключил мессенджер и не указал email' };
  return { status: 'RETRY', error: errors.join('; ') };
}

export { manageToken };
