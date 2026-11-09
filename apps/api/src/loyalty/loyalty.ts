import type { PassKind, Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { AppError, notFound } from '../common/errors';
import type { Tx } from '../common/prisma.service';
import { readSettings } from '../common/tenant-settings';

/**
 * Депозиты и абонементы. MioFlow только ведёт учёт — деньги принимает салон и выдаёт чек сам.
 * Баланс клиента: деньги (возвратные) + бонусы (невозвратные). При оплате визита списываются
 * пропорционально; при возврате денег сгорает пропорциональная часть бонусов.
 */
type Ctx = { tenantId: string; userId?: string | null };
export type TimeRule = { days?: number[]; from?: string; to?: string } | null;

async function customer(tx: Tx, id: string) {
  const c = await tx.customer.findFirst({ where: { id, deletedAt: null }, select: { id: true, balance: true, bonus: true } });
  if (!c) throw notFound('Клиент');
  return c;
}

/** Бонус по ступеням салона: «пополни 5000 — получи +500» (берётся самая выгодная подходящая ступень) */
export function bonusForTopup(amount: number, tiers: { amount: number; bonus: number }[]) {
  return tiers.filter((t) => amount >= t.amount).reduce((best, t) => Math.max(best, t.bonus), 0);
}

export async function topup(tx: Tx, ctx: Ctx, customerId: string, p: { money: number; bonus: number; method?: string; note?: string }) {
  await customer(tx, customerId);
  if (p.money <= 0 || p.bonus < 0) throw new AppError('VALIDATION_ERROR', 'Сумма пополнения должна быть больше нуля');
  await tx.accountEntry.create({ data: { tenantId: ctx.tenantId, customerId, type: 'TOPUP', money: p.money, bonus: p.bonus, method: p.method, note: p.note, userId: ctx.userId ?? null } });
  return tx.customer.update({ where: { id: customerId }, data: { balance: { increment: p.money }, bonus: { increment: p.bonus } }, select: { balance: true, bonus: true } });
}

/** Возврат неизрасходованных денег (по закону клиент вправе их потребовать). Бонусы сгорают пропорционально. */
export async function refund(tx: Tx, ctx: Ctx, customerId: string, p: { money: number; method?: string; note?: string }) {
  const c = await customer(tx, customerId);
  if (p.money <= 0 || p.money > c.balance) throw new AppError('VALIDATION_ERROR', `Вернуть можно не больше ${c.balance / 100} ₽`);
  const burn = Math.min(c.bonus, Math.round((c.bonus * p.money) / c.balance));
  await tx.accountEntry.create({
    data: { tenantId: ctx.tenantId, customerId, type: 'REFUND', money: -p.money, bonus: -burn, method: p.method, note: p.note ?? (burn ? 'бонусы сгорают пропорционально возврату' : null), userId: ctx.userId ?? null },
  });
  return tx.customer.update({ where: { id: customerId }, data: { balance: { decrement: p.money }, bonus: { decrement: burn } }, select: { balance: true, bonus: true } });
}

/** Подходит ли время визита под окно абонемента (дни недели и часы в поясе салона) */
export function fitsTimeRule(rule: TimeRule, startsAt: Date, endsAt: Date, tz: string) {
  if (!rule) return true;
  const s = DateTime.fromJSDate(startsAt).setZone(tz), e = DateTime.fromJSDate(endsAt).setZone(tz);
  if (rule.days?.length && !rule.days.includes(s.weekday)) return false;
  if (rule.from && s.toFormat('HH:mm') < rule.from) return false;
  if (rule.to && (e.toFormat('HH:mm') > rule.to || !e.hasSame(s, 'day'))) return false;
  return true;
}

type PassRow = { id: string; kind: PassKind; visitsLeft: number | null; serviceIds: string[]; timeRule: Prisma.JsonValue; expiresAt: Date; startsAt: Date };

/** Подобрать абонемент для визита: покрывает все услуги, подходит по времени, срок раньше всех истекает */
async function findPass(tx: Tx, b: { id: string; customerId: string; startsAt: Date; endsAt: Date; items: { serviceId: string }[] }, tz: string) {
  const passes: PassRow[] = await tx.customerPass.findMany({
    where: { customerId: b.customerId, status: 'ACTIVE', startsAt: { lte: b.startsAt }, expiresAt: { gt: b.startsAt } },
    orderBy: { expiresAt: 'asc' },
    select: { id: true, kind: true, visitsLeft: true, serviceIds: true, timeRule: true, expiresAt: true, startsAt: true },
  });
  if (!passes.length) return null;
  // Комплекс покрыт, если в абонемент входит сам комплекс или все его части
  const combos = await tx.service.findMany({ where: { id: { in: b.items.map((i) => i.serviceId) } }, select: { id: true, comboOf: true } });
  const parts = new Map(combos.map((c) => [c.id, c.comboOf]));
  const covers = (p: PassRow) =>
    !p.serviceIds.length || b.items.every((i) => p.serviceIds.includes(i.serviceId) || ((parts.get(i.serviceId)?.length ?? 0) > 0 && parts.get(i.serviceId)!.every((x) => p.serviceIds.includes(x))));
  for (const p of passes) {
    if (p.kind === 'VISITS' && !(p.visitsLeft && p.visitsLeft > 0)) continue;
    if (!covers(p) || !fitsTimeRule(p.timeRule as TimeRule, b.startsAt, b.endsAt, tz)) continue;
    if (p.kind === 'UNLIMITED') {
      // Безлимит — не больше одного визита в день
      const day = DateTime.fromJSDate(b.startsAt).setZone(tz);
      const uses = await tx.passUse.findMany({ where: { passId: p.id, bookingId: { not: b.id } }, select: { bookingId: true } });
      if (uses.length) {
        const visits = await tx.booking.findMany({ where: { id: { in: uses.map((u) => u.bookingId) } }, select: { startsAt: true } });
        if (visits.some((v) => DateTime.fromJSDate(v.startsAt).setZone(tz).hasSame(day, 'day'))) continue;
      }
    }
    return p;
  }
  return null;
}

/**
 * Оплата завершённого визита: сначала подходящий абонемент, иначе — депозит (если включено автосписание).
 * Повторное завершение после отката не списывает дважды.
 */
export async function settleBooking(tx: Tx, ctx: Ctx, bookingId: string) {
  if (await tx.passUse.findUnique({ where: { bookingId } })) return;
  const net = await tx.accountEntry.aggregate({ where: { bookingId, type: { in: ['CHARGE', 'RETURN'] } }, _sum: { money: true, bonus: true } });
  if ((net._sum.money ?? 0) !== 0 || (net._sum.bonus ?? 0) !== 0) return;
  const b = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { id: true, customerId: true, startsAt: true, endsAt: true, price: true, items: { select: { serviceId: true } } },
  });
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { timezone: true, settings: true } });

  const pass = await findPass(tx, b, t.timezone);
  if (pass) {
    await tx.passUse.create({ data: { tenantId: ctx.tenantId, passId: pass.id, bookingId } });
    if (pass.kind === 'VISITS') {
      const left = (pass.visitsLeft ?? 1) - 1;
      await tx.customerPass.update({ where: { id: pass.id }, data: { visitsLeft: left, ...(left <= 0 ? { status: 'USED' } : {}) } });
    }
    return;
  }

  if (!readSettings(t.settings).depositAutoCharge || b.price <= 0) return;
  const c = await customer(tx, b.customerId);
  const total = Math.max(0, c.balance) + Math.max(0, c.bonus);
  if (!total) return;
  const amount = Math.min(b.price, total);
  const money = Math.min(c.balance, Math.round((amount * c.balance) / total));
  const bonus = amount - money;
  await tx.accountEntry.create({ data: { tenantId: ctx.tenantId, customerId: b.customerId, type: 'CHARGE', money: -money, bonus: -bonus, bookingId, userId: ctx.userId ?? null } });
  await tx.customer.update({ where: { id: b.customerId }, data: { balance: { decrement: money }, bonus: { decrement: bonus } } });
}

/** Завершение визита отменили — возвращаем визит в абонемент и деньги на депозит */
export async function unsettleBooking(tx: Tx, ctx: Ctx, bookingId: string) {
  const use = await tx.passUse.findUnique({ where: { bookingId }, include: { pass: true } });
  if (use) {
    await tx.passUse.delete({ where: { id: use.id } });
    if (use.pass.kind === 'VISITS') {
      await tx.customerPass.update({
        where: { id: use.passId },
        data: { visitsLeft: { increment: 1 }, ...(use.pass.status === 'USED' ? { status: 'ACTIVE' } : {}) },
      });
    }
  }
  const net = await tx.accountEntry.aggregate({ where: { bookingId, type: { in: ['CHARGE', 'RETURN'] } }, _sum: { money: true, bonus: true } });
  const money = -(net._sum.money ?? 0), bonus = -(net._sum.bonus ?? 0);
  if (money > 0 || bonus > 0) {
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { customerId: true } });
    await tx.accountEntry.create({ data: { tenantId: ctx.tenantId, customerId: b.customerId, type: 'RETURN', money, bonus, bookingId, userId: ctx.userId ?? null, note: 'завершение визита отменено' } });
    await tx.customer.update({ where: { id: b.customerId }, data: { balance: { increment: money }, bonus: { increment: bonus } } });
  }
}

/** Как оплачен визит — для карточки записи */
export async function settlementOf(tx: Tx, bookingId: string) {
  const [use, net] = await Promise.all([
    tx.passUse.findUnique({ where: { bookingId }, include: { pass: { select: { name: true, kind: true, visitsLeft: true, expiresAt: true } } } }),
    tx.accountEntry.aggregate({ where: { bookingId, type: { in: ['CHARGE', 'RETURN'] } }, _sum: { money: true, bonus: true } }),
  ]);
  const charged = -((net._sum.money ?? 0) + (net._sum.bonus ?? 0));
  return {
    pass: use ? { name: use.pass.name, kind: use.pass.kind, visitsLeft: use.pass.visitsLeft, expiresAt: use.pass.expiresAt } : null,
    fromBalance: charged > 0 ? charged : 0,
  };
}

/** Абонементы с истёкшим сроком переводим в EXPIRED при чтении */
export async function expirePasses(tx: Tx, customerId?: string) {
  await tx.customerPass.updateMany({ where: { status: 'ACTIVE', expiresAt: { lte: new Date() }, ...(customerId ? { customerId } : {}) }, data: { status: 'EXPIRED' } });
}
