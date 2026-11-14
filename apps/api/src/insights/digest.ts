import type { PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';
import { readSettings } from '../common/tenant-settings';
import { env } from '../config';
import { notifyStaff } from '../notify/staff';
import { esc } from '../notify/telegram';
import { computeInsights, Insight } from './insights';

const ICON: Record<Insight['level'], string> = { warn: '⚠️', tip: '💡', good: '🎉' };
const rub = (kop: number) => `${Math.round(kop / 100).toLocaleString('ru-RU')} ₽`;

/** Текст еженедельной сводки: итоги прошлой недели и до 4 советов */
export async function digestText(db: PrismaClient, tenantId: string, now = new Date()) {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, timezone: true } });
  const today = DateTime.fromJSDate(now).setZone(t.timezone).startOf('day');
  const weekAgo = today.minus({ days: 7 }).toJSDate(), twoWeeks = today.minus({ days: 14 }).toJSDate();
  const active = { in: ['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'COMPLETED'] as ('SCHEDULED' | 'CONFIRMED' | 'ARRIVED' | 'COMPLETED')[] };
  const [cur, prev, reviews, insights] = await Promise.all([
    db.booking.aggregate({ where: { tenantId, status: active, startsAt: { gte: weekAgo, lt: today.toJSDate() } }, _sum: { price: true }, _count: true }),
    db.booking.aggregate({ where: { tenantId, status: active, startsAt: { gte: twoWeeks, lt: weekAgo } }, _sum: { price: true } }),
    db.review.aggregate({ where: { tenantId, createdAt: { gte: weekAgo } }, _avg: { rating: true }, _count: true }),
    computeInsights(db, tenantId, now),
  ]);
  const sum = cur._sum.price ?? 0, before = prev._sum.price ?? 0;
  const delta = before ? Math.round((sum / before - 1) * 100) : null;
  const lines = [
    `📊 <b>Неделя в «${esc(t.name)}»</b>`,
    `Записей: ${cur._count} на ${rub(sum)}${delta !== null ? ` (${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% к прошлой)` : ''}`,
    reviews._count ? `Оценка клиентов: ${(reviews._avg.rating ?? 0).toFixed(1)} ⭐ (${reviews._count})` : null,
    '',
    ...(insights.length ? insights.slice(0, 4).flatMap((i) => [`${ICON[i.level]} <b>${esc(i.title)}</b>`, esc(i.text), '']) : ['Всё спокойно — особых советов на этой неделе нет.']),
  ].filter((x) => x !== null);
  return { text: lines.join('\n').trim(), insights };
}

/**
 * Раз в неделю, в понедельник с 10:00 по времени салона, владелец получает сводку в Telegram и push.
 * Запускается воркером каждый час; insightsSentAt защищает от повторной отправки.
 */
export async function insightsDigestTick(db: PrismaClient, now = new Date()) {
  const tenants = await db.tenant.findMany({
    where: { deletedAt: null, subscription: { status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] } } },
    select: { id: true, timezone: true, settings: true, insightsSentAt: true },
  });
  let sent = 0;
  for (const t of tenants) {
    if (!readSettings(t.settings).insightsDigest) continue;
    const local = DateTime.fromJSDate(now).setZone(t.timezone);
    const weekStart = local.startOf('week'); // понедельник 00:00
    if (local.weekday !== 1 || local.hour < 10) continue;
    if (t.insightsSentAt && +t.insightsSentAt >= +weekStart) continue;
    // Сначала отмечаем, потом шлём: при сбое лучше пропустить неделю, чем прислать дважды
    const claimed = await db.tenant.updateMany({ where: { id: t.id, OR: [{ insightsSentAt: null }, { insightsSentAt: { lt: weekStart.toJSDate() } }] }, data: { insightsSentAt: now } });
    if (!claimed.count) continue;
    const { text } = await digestText(db, t.id, now);
    const n = await notifyStaff(db, t.id, text, {
      ownersOnly: true,
      buttons: env.APP_URL ? [[{ text: 'Открыть обзор', url: `${env.APP_URL}/dashboard` }]] : undefined,
      push: { title: 'Итоги недели и советы', body: 'Что можно улучшить в салоне на этой неделе', data: { route: '/dashboard' } },
    });
    if (n) sent++;
  }
  return { sent };
}
