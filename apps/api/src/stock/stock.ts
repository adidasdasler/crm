import type { StockMovementType } from '@prisma/client';
import { DateTime } from 'luxon';
import { AppError, notFound } from '../common/errors';
import type { Tx } from '../common/prisma.service';

/**
 * Склад. Количества в БД — целые тысячные доли единицы (1 мл = 1000), в API — обычные числа.
 * Инвариант: сумма остатков партий = max(остаток материала, 0). Остаток может уйти в минус,
 * если расход списали раньше прихода; следующий приход сначала покрывает минус.
 */
export const UNITS = ['шт', 'мл', 'г', 'л', 'кг', 'пар', 'упак', 'м'] as const;
export const toQ = (n: number) => Math.round(n * 1000);
export const fromQ = (q: number) => Math.round(q) / 1000;

type Ctx = { tenantId: string; userId?: string | null };
type Extra = { bookingId?: string | null; note?: string | null };

async function material(tx: Tx, id: string) {
  const m = await tx.material.findFirst({ where: { id, deletedAt: null } });
  if (!m) throw notFound('Материал');
  return m;
}

/** Приход партии. Если остаток в минусе, приход сначала покрывает недостачу. */
export async function receive(
  tx: Tx, ctx: Ctx, p: { materialId: string; qty: number; costPerUnit?: number; expiresAt?: Date | null; note?: string | null },
  type: StockMovementType = 'RECEIPT',
) {
  const m = await material(tx, p.materialId);
  if (p.qty <= 0) throw new AppError('VALIDATION_ERROR', 'Количество должно быть больше нуля');
  const cost = p.costPerUnit ?? m.lastCost;
  const covers = Math.min(p.qty, Math.max(0, -m.stock));
  const batch = await tx.materialBatch.create({
    data: { tenantId: ctx.tenantId, materialId: m.id, qty: p.qty, remaining: p.qty - covers, costPerUnit: cost, expiresAt: p.expiresAt ?? null },
  });
  await tx.stockMovement.create({
    data: { tenantId: ctx.tenantId, materialId: m.id, batchId: batch.id, type, qty: p.qty, costPerUnit: cost, userId: ctx.userId ?? null, note: p.note ?? null },
  });
  await tx.material.update({ where: { id: m.id }, data: { stock: { increment: p.qty }, ...(type === 'RECEIPT' && p.costPerUnit !== undefined ? { lastCost: p.costPerUnit } : {}) } });
  return batch;
}

/**
 * Расход: сначала партии, у которых срок годности истекает раньше (FEFO), затем без срока — от старых к новым.
 * Если партий не хватает, остаток уходит в минус (визит уже состоялся — расход реальный).
 */
export async function consume(tx: Tx, ctx: Ctx, materialId: string, qty: number, type: StockMovementType, extra: Extra = {}, onlyBatchId?: string) {
  const m = await material(tx, materialId);
  if (qty <= 0) return 0;
  const batches = await tx.materialBatch.findMany({
    where: { materialId, remaining: { gt: 0 }, ...(onlyBatchId ? { id: onlyBatchId } : {}) },
    orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }],
  });
  let left = qty;
  let cost = 0;
  for (const b of batches) {
    if (!left) break;
    const take = Math.min(left, b.remaining);
    await tx.materialBatch.update({ where: { id: b.id }, data: { remaining: { decrement: take } } });
    await tx.stockMovement.create({
      data: { tenantId: ctx.tenantId, materialId, batchId: b.id, type, qty: -take, costPerUnit: b.costPerUnit, userId: ctx.userId ?? null, bookingId: extra.bookingId ?? null, note: extra.note ?? null },
    });
    cost += Math.round((take / 1000) * b.costPerUnit);
    left -= take;
  }
  if (left && onlyBatchId) throw new AppError('VALIDATION_ERROR', 'В партии нет столько материала');
  if (left) {
    await tx.stockMovement.create({
      data: { tenantId: ctx.tenantId, materialId, type, qty: -left, costPerUnit: m.lastCost, userId: ctx.userId ?? null, bookingId: extra.bookingId ?? null, note: extra.note ?? 'не хватило на складе' },
    });
    cost += Math.round((left / 1000) * m.lastCost);
  }
  await tx.material.update({ where: { id: materialId }, data: { stock: { decrement: qty } } });
  return cost;
}

/** Инвентаризация: привести остаток к фактическому */
export async function adjust(tx: Tx, ctx: Ctx, materialId: string, actual: number, note?: string) {
  const m = await material(tx, materialId);
  const diff = actual - m.stock;
  if (diff > 0) await receive(tx, ctx, { materialId, qty: diff, note: note ?? 'инвентаризация' }, 'ADJUST');
  else if (diff < 0) await consume(tx, ctx, materialId, -diff, 'ADJUST', { note: note ?? 'инвентаризация' });
  return diff;
}

/**
 * Автосписание при завершении визита по нормам услуг. Для комплекса без своих норм берутся нормы
 * входящих в него услуг. Повторное завершение (после отката) не списывает дважды.
 */
export async function consumeForBooking(tx: Tx, ctx: Ctx, bookingId: string) {
  const net = await tx.stockMovement.aggregate({ where: { bookingId, type: { in: ['SERVICE', 'RETURN'] } }, _sum: { qty: true } });
  if ((net._sum.qty ?? 0) !== 0) return;
  const items = await tx.bookingItem.findMany({
    where: { bookingId },
    select: { service: { select: { comboOf: true, materials: { select: { materialId: true, qty: true } } } } },
  });
  const need = new Map<string, number>();
  const add = (list: { materialId: string; qty: number }[]) => list.forEach((x) => need.set(x.materialId, (need.get(x.materialId) ?? 0) + x.qty));
  for (const { service } of items) {
    if (service.materials.length) add(service.materials);
    else if (service.comboOf.length) add(await tx.serviceMaterial.findMany({ where: { serviceId: { in: service.comboOf } }, select: { materialId: true, qty: true } }));
  }
  for (const [materialId, qty] of need) {
    const m = await tx.material.findFirst({ where: { id: materialId, deletedAt: null, isActive: true }, select: { id: true } });
    if (m) await consume(tx, ctx, materialId, qty, 'SERVICE', { bookingId });
  }
}

/** Завершение визита отменили — возвращаем списанное в те же партии */
export async function returnForBooking(tx: Tx, ctx: Ctx, bookingId: string) {
  const moves = await tx.stockMovement.findMany({ where: { bookingId, type: { in: ['SERVICE', 'RETURN'] } } });
  const net = new Map<string, number>();
  for (const mv of moves) {
    const k = `${mv.materialId}|${mv.batchId ?? ''}|${mv.costPerUnit}`;
    net.set(k, (net.get(k) ?? 0) + mv.qty);
  }
  for (const [k, q] of net) {
    if (q >= 0) continue;
    const [materialId, batchId, cost] = k.split('|');
    const back = -q;
    if (batchId) await tx.materialBatch.update({ where: { id: batchId }, data: { remaining: { increment: back } } });
    await tx.stockMovement.create({
      data: { tenantId: ctx.tenantId, materialId, batchId: batchId || null, type: 'RETURN', qty: back, costPerUnit: Number(cost), bookingId, userId: ctx.userId ?? null, note: 'завершение визита отменено' },
    });
    await tx.material.update({ where: { id: materialId }, data: { stock: { increment: back } } });
  }
}

/** Предупреждения: заканчивается, истекает срок (30 дней), просрочено */
export async function stockAlerts(tx: Tx, tz: string) {
  const today = DateTime.now().setZone(tz).startOf('day');
  const soon = today.plus({ days: 30 }).toJSDate();
  const [materials, batches] = await Promise.all([
    tx.material.findMany({ where: { deletedAt: null, isActive: true, minStock: { gt: 0 } }, select: { id: true, name: true, unit: true, stock: true, minStock: true } }),
    tx.materialBatch.findMany({
      where: { remaining: { gt: 0 }, expiresAt: { not: null, lte: soon }, material: { deletedAt: null, isActive: true } },
      orderBy: { expiresAt: 'asc' },
      select: { id: true, remaining: true, expiresAt: true, material: { select: { id: true, name: true, unit: true } } },
    }),
  ]);
  const todayDate = today.toISODate()!;
  return {
    low: materials.filter((m) => m.stock <= m.minStock).map((m) => ({ materialId: m.id, name: m.name, unit: m.unit, stock: fromQ(m.stock), minStock: fromQ(m.minStock) })),
    expiring: batches.map((b) => {
      const d = b.expiresAt!.toISOString().slice(0, 10);
      return {
        batchId: b.id, materialId: b.material.id, name: b.material.name, unit: b.material.unit, remaining: fromQ(b.remaining),
        expiresAt: d, expired: d < todayDate, daysLeft: Math.round((+new Date(d) - +new Date(todayDate)) / 86400_000),
      };
    }),
  };
}
