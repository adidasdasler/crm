/**
 * Онлайн-предоплата при записи. Платёж создаётся в магазине ЮKassa САЛОНА (его shopId и ключ),
 * поэтому деньги сразу поступают салону — сервис их не принимает и не перечисляет.
 * Неоплаченная запись держит время 20 минут, потом отменяется и окно освобождается.
 */
import type { PrismaClient } from '@prisma/client';
import { isProd } from '../config';
import { open } from '../common/secret-box';

export const HOLD_MIN = 20;
export type Creds = { shopId: string; secret: string };
export type PayStatus = 'pending' | 'succeeded' | 'canceled';

const auth = (c: Creds) => 'Basic ' + Buffer.from(`${c.shopId}:${c.secret}`).toString('base64');
/** Режим разработки: shopId «mock» — платёж сразу «оплачен», без денег */
const isMock = (c: Creds) => !isProd && c.shopId === 'mock';

/** Методы можно подменить в тестах */
export const salonPay = {
  async create(c: Creds, p: { idempotenceKey: string; amount: number; description: string; returnUrl: string; metadata: Record<string, string> }) {
    if (isMock(c)) return { externalId: `mock_${p.idempotenceKey}`, confirmationUrl: p.returnUrl };
    const res = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotence-Key': p.idempotenceKey, Authorization: auth(c) },
      body: JSON.stringify({
        amount: { value: (p.amount / 100).toFixed(2), currency: 'RUB' },
        capture: true,
        confirmation: { type: 'redirect', return_url: p.returnUrl },
        description: p.description.slice(0, 128),
        metadata: p.metadata,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json()) as { id?: string; confirmation?: { confirmation_url?: string }; description?: string };
    if (!res.ok || !json.id || !json.confirmation?.confirmation_url) throw new Error(json.description ?? `HTTP ${res.status}`);
    return { externalId: json.id, confirmationUrl: json.confirmation.confirmation_url };
  },
  async status(c: Creds, externalId: string): Promise<PayStatus> {
    if (isMock(c)) return 'succeeded';
    const res = await fetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(externalId)}`, { headers: { Authorization: auth(c) }, signal: AbortSignal.timeout(15_000) });
    const json = (await res.json()) as { status?: string };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return json.status === 'succeeded' ? 'succeeded' : json.status === 'canceled' ? 'canceled' : 'pending';
  },
  /** Проверить ключи при сохранении настроек: GET /v3/me */
  async verify(c: Creds): Promise<boolean> {
    if (isMock(c)) return true;
    const res = await fetch('https://api.yookassa.ru/v3/me', { headers: { Authorization: auth(c) }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
    return !!res?.ok;
  },
};

export function prepayAmount(s: { mode: string; value: number }, price: number) {
  if (price <= 0) return 0;
  const raw = s.mode === 'fixed' ? Math.min(s.value, price) : Math.round((price * s.value) / 100);
  return Math.max(100, Math.round(raw / 100) * 100); // целые рубли, не меньше 1 ₽
}

export const credsOf = (s: { shopId: string | null; secretEnc: string | null }): Creds | null =>
  s.shopId && s.secretEnc ? { shopId: s.shopId, secret: open(s.secretEnc) } : null;

/**
 * Синхронизировать платёж с ЮKassa. Вызывается со страницы записи после оплаты, из вебхука и воркером.
 * system — без RLS (платёж ищем по id из метаданных).
 */
export async function syncPayment(system: PrismaClient, paymentId: string) {
  const p = await system.bookingPayment.findUnique({ where: { id: paymentId } });
  if (!p || p.status !== 'PENDING' || !p.externalId) return p?.status ?? null;
  const s = await system.tenantPaymentSettings.findUnique({ where: { tenantId: p.tenantId } });
  const creds = s && credsOf(s);
  if (!creds) return p.status;
  const st = await salonPay.status(creds, p.externalId);
  if (st === 'succeeded') {
    await system.bookingPayment.update({ where: { id: p.id }, data: { status: 'SUCCEEDED', paidAt: new Date() } });
    return 'SUCCEEDED';
  }
  if (st === 'canceled') {
    await system.bookingPayment.update({ where: { id: p.id }, data: { status: 'CANCELED' } });
    return 'CANCELED';
  }
  return 'PENDING';
}

/**
 * Воркер: неоплаченные дольше 20 минут — ещё раз спрашиваем ЮKassa (вдруг вебхук потерялся),
 * не оплачено — отменяем запись, чтобы время освободилось.
 */
export async function prepaymentTick(system: PrismaClient, now = new Date()) {
  const stale = await system.bookingPayment.findMany({
    where: { status: 'PENDING', createdAt: { lt: new Date(+now - HOLD_MIN * 60_000) } },
    take: 100,
  });
  let cancelled = 0;
  for (const p of stale) {
    const st = await syncPayment(system, p.id).catch(() => 'PENDING');
    if (st === 'SUCCEEDED') continue;
    await system.bookingPayment.update({ where: { id: p.id }, data: { status: 'CANCELED' } });
    const r = await system.booking.updateMany({
      where: { id: p.bookingId, status: { in: ['SCHEDULED', 'CONFIRMED'] } },
      data: { status: 'CANCELLED', cancelledAt: now, version: { increment: 1 } },
    });
    if (r.count) {
      await system.reminder.updateMany({ where: { bookingId: p.bookingId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
      await system.auditLog.create({ data: { tenantId: p.tenantId, action: 'booking.prepay_timeout', entityType: 'Booking', entityId: p.bookingId } });
      cancelled++;
    }
  }
  return { cancelled };
}
