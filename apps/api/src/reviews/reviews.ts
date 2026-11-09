import type { Prisma, PrismaClient } from '@prisma/client';
import { readSettings } from '../common/tenant-settings';
import type { Button } from '../notify/channels';
import { notifyStaff } from '../notify/staff';
import { esc } from '../notify/telegram';

type Db = PrismaClient | Prisma.TransactionClient;

/** Через сколько после окончания визита просим оценку */
export const FEEDBACK_DELAY_MIN = 120;
/** Оценку можно поставить или поменять в течение этого срока после визита */
export const FEEDBACK_WINDOW_DAYS = 7;

/** Кнопки 1–5 (в мессенджерах) и ссылка на страницу оценки (в письме) */
export function feedbackButtons(bookingId: string, url: string): Button[][] {
  return [
    [1, 2, 3, 4, 5].map((n) => ({ text: `${n}⭐`, data: `r:${n}:${bookingId}` })),
    [{ text: 'Оценить визит', url: `${url}?rate=1` }],
  ];
}

export function feedbackText(c: { salon: string; services: string[]; master: string }) {
  return [
    '<b>Как прошёл визит?</b>',
    '',
    `${esc(c.services.join(', '))} · мастер ${esc(c.master)}`,
    `<b>${esc(c.salon)}</b>`,
    '',
    'Оцените от 1 до 5 — это займёт секунду и поможет салону стать лучше.',
  ].join('\n');
}

/** Запланировать просьбу об оценке после завершения визита (или снять её при откате) */
export async function scheduleFeedback(tx: Db, b: { id: string; tenantId: string; endsAt: Date }, completed: boolean) {
  if (!completed) {
    await tx.reminder.updateMany({ where: { bookingId: b.id, type: 'AFTER_VISIT', status: 'PENDING' }, data: { status: 'CANCELLED' } });
    return;
  }
  const t = await tx.tenant.findUnique({ where: { id: b.tenantId }, select: { settings: true } });
  if (!t || !readSettings(t.settings).feedbackEnabled) return;
  if (await tx.review.findUnique({ where: { bookingId: b.id }, select: { id: true } })) return;
  const at = new Date(Math.max(Date.now(), +b.endsAt) + FEEDBACK_DELAY_MIN * 60_000);
  await tx.reminder.upsert({
    where: { bookingId_type: { bookingId: b.id, type: 'AFTER_VISIT' } },
    create: { tenantId: b.tenantId, bookingId: b.id, type: 'AFTER_VISIT', channel: 'TELEGRAM', scheduledAt: at },
    update: { status: 'PENDING', scheduledAt: at, attempts: 0, lastError: null, sentAt: null },
  });
}

/** Сохранить оценку (повторная — обновляет). Только для завершённых визитов не старше недели. */
export async function submitReview(db: Db, p: { bookingId: string; rating: number; comment?: string | null; source: string }) {
  if (!Number.isInteger(p.rating) || p.rating < 1 || p.rating > 5) return { ok: false as const, error: 'Оценка от 1 до 5' };
  const b = await db.booking.findUnique({ where: { id: p.bookingId }, select: { id: true, tenantId: true, status: true, endsAt: true, customerId: true, resourceId: true } });
  if (!b || b.status !== 'COMPLETED') return { ok: false as const, error: 'Оценить можно только состоявшийся визит' };
  if (Date.now() - +b.endsAt > FEEDBACK_WINDOW_DAYS * 86400_000) return { ok: false as const, error: 'Срок для оценки этого визита прошёл' };
  const prev = await db.review.findUnique({ where: { bookingId: b.id } });
  const comment = p.comment?.trim().slice(0, 1000) || undefined;
  const review = await db.review.upsert({
    where: { bookingId: b.id },
    create: { tenantId: b.tenantId, bookingId: b.id, customerId: b.customerId, resourceId: b.resourceId, rating: p.rating, comment: comment ?? null, source: p.source },
    update: { rating: p.rating, ...(comment !== undefined ? { comment } : {}) },
  });
  // Оценку уже поставили — просьбу больше не шлём
  await db.reminder.updateMany({ where: { bookingId: b.id, type: 'AFTER_VISIT', status: 'PENDING' }, data: { status: 'CANCELLED' } });
  return { ok: true as const, review, prev };
}

/**
 * Реакция на оценку: 4–5 — просим отзыв на картах (если салон указал ссылки),
 * 1–3 — просим рассказать, что не так, и сразу сообщаем владельцу, чтобы он успел всё уладить.
 */
export async function afterRating(system: PrismaClient, review: { tenantId: string; bookingId: string; rating: number; comment: string | null }, changed: boolean) {
  const b = await system.booking.findUniqueOrThrow({
    where: { id: review.bookingId },
    select: { startsAt: true, customer: { select: { name: true, phone: true } }, resource: { select: { name: true, id: true } }, items: { select: { name: true } } },
  });
  const t = await system.tenant.findUniqueOrThrow({ where: { id: review.tenantId }, select: { settings: true, timezone: true } });
  const links = readSettings(t.settings).links ?? {};
  if (review.rating <= 3 && changed) {
    const when = b.startsAt.toLocaleString('ru-RU', { timeZone: t.timezone, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    void notifyStaff(system, review.tenantId,
      `⚠️ <b>Низкая оценка: ${review.rating} из 5</b>\n${esc(b.customer.name)}, ${esc(b.customer.phone)}\n${esc(when)} · ${esc(b.items.map((i) => i.name).join(', '))} · мастер ${esc(b.resource.name)}${review.comment ? `\n«${esc(review.comment)}»` : ''}\n\nСвяжитесь с клиентом, пока он не написал отзыв на картах.`,
      { push: { title: `Оценка ${review.rating} из 5`, body: `${b.customer.name} · мастер ${b.resource.name}`, data: { bookingId: review.bookingId } } },
    );
  }
  if (review.rating >= 4) {
    const buttons: Button[][] = [];
    if (links.yandexMaps) buttons.push([{ text: '⭐ Отзыв на Яндекс Картах', url: links.yandexMaps }]);
    if (links.twoGis) buttons.push([{ text: '⭐ Отзыв в 2ГИС', url: links.twoGis }]);
    return {
      text: buttons.length
        ? `Спасибо за ${review.rating}⭐! Нам очень приятно.\n\nЕсли не трудно, оставьте пару слов на картах — это помогает мастеру ${esc(b.resource.name)} и другим людям найти салон.`
        : `Спасибо за ${review.rating}⭐! Нам очень приятно. Будем рады видеть вас снова.`,
      buttons: buttons.length ? buttons : undefined,
    };
  }
  return { text: `Спасибо, что честно оценили визит. Напишите одним сообщением, что пошло не так, — владелец салона прочитает и свяжется с вами.` };
}

/** Комментарий к оценке — следующее сообщение клиента в течение суток */
export async function attachComment(system: PrismaClient, customerIds: string[], text: string) {
  if (!customerIds.length) return null;
  const r = await system.review.findFirst({
    where: { customerId: { in: customerIds }, comment: null, updatedAt: { gt: new Date(Date.now() - 86400_000) } },
    orderBy: { updatedAt: 'desc' },
  });
  if (!r) return null;
  const updated = await system.review.update({ where: { id: r.id }, data: { comment: text.trim().slice(0, 1000) } });
  if (updated.rating <= 3) await afterRating(system, updated, true);
  return updated;
}
