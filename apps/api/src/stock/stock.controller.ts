import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { audit } from '../common/audit';
import { Auth, AuthCtx, Can } from '../common/auth';
import { AppError, notFound } from '../common/errors';
import { Zod } from '../common/http';
import { PrismaService } from '../common/prisma.service';
import { uuid } from '../common/schemas';
import { readSettings } from '../common/tenant-settings';
import { adjust, consume, fromQ, receive, stockAlerts, toQ, UNITS } from './stock';
import { STOCK_TEMPLATES } from './templates';

const qty = z.number().positive().max(10_000_000);
const materialSchema = z.object({
  name: z.string().trim().min(1).max(150),
  unit: z.enum(UNITS),
  category: z.string().trim().max(60).nullish(),
  minStock: z.number().min(0).max(10_000_000).optional(),
  trackExpiry: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
const receiptSchema = z.object({
  materialId: uuid,
  qty,
  /** Цена за единицу, ₽ (копейки считает сервер) */
  price: z.number().min(0).max(10_000_000).optional(),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().trim().max(300).optional(),
});
const writeOffSchema = z.object({ materialId: uuid, qty, batchId: uuid.optional(), reason: z.string().trim().min(1).max(300) });
const inventorySchema = z.object({ items: z.array(z.object({ materialId: uuid, actual: z.number().min(0).max(10_000_000) })).min(1).max(500), note: z.string().trim().max(300).optional() });
const normsSchema = z.object({ items: z.array(z.object({ materialId: uuid, qty })).max(50) });

const MOVE_LABEL: Record<string, string> = { RECEIPT: 'Приход', SERVICE: 'Визит', WRITE_OFF: 'Списание', ADJUST: 'Инвентаризация', RETURN: 'Возврат' };

/**
 * Склад материалов: остатки, приход, списание, инвентаризация, нормы расхода на услуги,
 * предупреждения «заканчивается» и «истекает срок». Расход на визит списывается автоматически
 * при завершении записи (src/stock/stock.ts → consumeForBooking).
 */
@Can('stock.manage')
@Controller('stock')
export class StockController {
  constructor(private readonly prisma: PrismaService) {}

  @Can('stock.manage', 'catalog.manage')
  @Get('materials')
  list(@Auth() a: AuthCtx) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const rows = await tx.material.findMany({
        where: { deletedAt: null },
        orderBy: [{ category: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
        include: { batches: { where: { remaining: { gt: 0 }, expiresAt: { not: null } }, orderBy: { expiresAt: 'asc' }, take: 1, select: { expiresAt: true } } },
      });
      return rows.map(({ batches, ...m }) => ({ ...view(m), nearestExpiry: batches[0]?.expiresAt?.toISOString().slice(0, 10) ?? null }));
    });
  }

  @Get('materials/:id')
  get(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const m = await tx.material.findFirst({
        where: { id, deletedAt: null },
        include: {
          batches: { where: { remaining: { gt: 0 } }, orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }] },
          movements: { orderBy: { createdAt: 'desc' }, take: 50 },
          services: { include: { service: { select: { id: true, name: true } } } },
        },
      });
      if (!m) throw notFound('Материал');
      return {
        ...view(m),
        batches: m.batches.map((b) => ({ id: b.id, qty: fromQ(b.qty), remaining: fromQ(b.remaining), price: b.costPerUnit / 100, expiresAt: b.expiresAt?.toISOString().slice(0, 10) ?? null, receivedAt: b.receivedAt })),
        movements: m.movements.map((mv) => ({ id: mv.id, type: mv.type, label: MOVE_LABEL[mv.type], qty: fromQ(mv.qty), price: mv.costPerUnit / 100, bookingId: mv.bookingId, note: mv.note, createdAt: mv.createdAt })),
        norms: m.services.map((s) => ({ serviceId: s.service.id, service: s.service.name, qty: fromQ(s.qty) })),
      };
    });
  }

  @Post('materials')
  create(@Auth() a: AuthCtx, @Body(new Zod(materialSchema)) dto: z.infer<typeof materialSchema>) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const m = await tx.material.create({ data: { ...dto, minStock: toQ(dto.minStock ?? 0), tenantId: a.tenantId } });
      await audit(tx, a, 'stock.material.create', 'Material', m.id, null, m);
      return view(m);
    });
  }

  @Patch('materials/:id')
  update(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(materialSchema.partial())) dto: Partial<z.infer<typeof materialSchema>>) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const before = await tx.material.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw notFound('Материал');
      const m = await tx.material.update({ where: { id }, data: { ...dto, ...(dto.minStock !== undefined ? { minStock: toQ(dto.minStock) } : {}) } });
      await audit(tx, a, 'stock.material.update', 'Material', id, before, m);
      return view(m);
    });
  }

  @Delete('materials/:id')
  remove(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const m = await tx.material.findFirst({ where: { id, deletedAt: null } });
      if (!m) throw notFound('Материал');
      // История движений сохраняется для отчётов; нормы расхода больше не применяются
      await tx.serviceMaterial.deleteMany({ where: { materialId: id } });
      await tx.material.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
      await audit(tx, a, 'stock.material.delete', 'Material', id);
      return { ok: true };
    });
  }

  @Post('receipts')
  receipt(@Auth() a: AuthCtx, @Body(new Zod(receiptSchema)) dto: z.infer<typeof receiptSchema>) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const m = await tx.material.findFirst({ where: { id: dto.materialId, deletedAt: null } });
      if (!m) throw notFound('Материал');
      if (m.trackExpiry && !dto.expiresAt) throw new AppError('VALIDATION_ERROR', 'Укажите срок годности партии');
      await receive(tx, a, {
        materialId: dto.materialId, qty: toQ(dto.qty), note: dto.note,
        costPerUnit: dto.price !== undefined ? Math.round(dto.price * 100) : undefined,
        expiresAt: dto.expiresAt ? new Date(`${dto.expiresAt}T00:00:00Z`) : null,
      });
      return view(await tx.material.findUniqueOrThrow({ where: { id: dto.materialId } }));
    });
  }

  @Post('write-off')
  writeOff(@Auth() a: AuthCtx, @Body(new Zod(writeOffSchema)) dto: z.infer<typeof writeOffSchema>) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      await consume(tx, a, dto.materialId, toQ(dto.qty), 'WRITE_OFF', { note: dto.reason }, dto.batchId);
      return view(await tx.material.findUniqueOrThrow({ where: { id: dto.materialId } }));
    });
  }

  /** Инвентаризация: вводится фактический остаток, разница записывается в журнал */
  @Post('inventory')
  inventory(@Auth() a: AuthCtx, @Body(new Zod(inventorySchema)) dto: z.infer<typeof inventorySchema>) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const diffs = [];
      for (const it of dto.items) diffs.push({ materialId: it.materialId, diff: fromQ(await adjust(tx, a, it.materialId, toQ(it.actual), dto.note)) });
      await audit(tx, a, 'stock.inventory', 'Material', null, null, { items: diffs });
      return { items: diffs };
    });
  }

  @Get('alerts')
  alerts(@Auth() a: AuthCtx) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { timezone: true } });
      return stockAlerts(tx, t.timezone);
    });
  }

  // ─── Нормы расхода на услугу ───
  @Can('stock.manage', 'catalog.manage')
  @Get('norms/:serviceId')
  norms(@Auth() a: AuthCtx, @Param('serviceId', ParseUUIDPipe) serviceId: string) {
    return this.prisma.withTenant(a.tenantId, async (tx) =>
      (await tx.serviceMaterial.findMany({ where: { serviceId }, include: { material: { select: { name: true, unit: true } } } }))
        .map((n) => ({ materialId: n.materialId, name: n.material.name, unit: n.material.unit, qty: fromQ(n.qty) })),
    );
  }

  @Can('stock.manage', 'catalog.manage')
  @Put('norms/:serviceId')
  setNorms(@Auth() a: AuthCtx, @Param('serviceId', ParseUUIDPipe) serviceId: string, @Body(new Zod(normsSchema)) dto: z.infer<typeof normsSchema>) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      if (!(await tx.service.findFirst({ where: { id: serviceId, deletedAt: null } }))) throw notFound('Услуга');
      const ids = [...new Set(dto.items.map((i) => i.materialId))];
      if (ids.length !== dto.items.length) throw new AppError('VALIDATION_ERROR', 'Материал указан дважды');
      if ((await tx.material.count({ where: { id: { in: ids }, deletedAt: null } })) !== ids.length) throw notFound('Материал');
      await tx.serviceMaterial.deleteMany({ where: { serviceId } });
      if (dto.items.length) await tx.serviceMaterial.createMany({ data: dto.items.map((i) => ({ tenantId: a.tenantId, serviceId, materialId: i.materialId, qty: toQ(i.qty) })) });
      await audit(tx, a, 'stock.norms', 'Service', serviceId, null, dto.items);
      return { ok: true };
    });
  }

  // ─── Отраслевой набор ───
  @Get('template')
  async template(@Auth() a: AuthCtx) {
    const t = await this.prisma.withTenant(a.tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { settings: true } }));
    const code = readSettings(t.settings).industry;
    return { industry: code, materials: (STOCK_TEMPLATES[code] ?? []).map(({ norms, ...m }) => ({ ...m, services: Object.keys(norms ?? {}) })) };
  }

  /** Добавить материалы отрасли и привязать нормы к услугам с такими же названиями. Повторный вызов ничего не дублирует. */
  @Post('from-template')
  fromTemplate(@Auth() a: AuthCtx) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { settings: true } });
      const list = STOCK_TEMPLATES[readSettings(t.settings).industry] ?? [];
      const services = await tx.service.findMany({ where: { deletedAt: null }, select: { id: true, name: true } });
      const byName = new Map(services.map((s) => [s.name, s.id]));
      let created = 0, linked = 0;
      for (const tpl of list) {
        let m = await tx.material.findFirst({ where: { name: tpl.name, deletedAt: null } });
        if (!m) {
          m = await tx.material.create({ data: { tenantId: a.tenantId, name: tpl.name, unit: tpl.unit, category: tpl.category, minStock: toQ(tpl.minStock), trackExpiry: !!tpl.trackExpiry } });
          created++;
        }
        for (const [svcName, q] of Object.entries(tpl.norms ?? {})) {
          const serviceId = byName.get(svcName);
          if (!serviceId) continue;
          const r = await tx.serviceMaterial.createMany({ data: [{ tenantId: a.tenantId, serviceId, materialId: m.id, qty: toQ(q) }], skipDuplicates: true });
          linked += r.count;
        }
      }
      await audit(tx, a, 'stock.template', 'Material', null, null, { created, linked });
      return { created, linked };
    });
  }
}

function view(m: { id: string; name: string; unit: string; category: string | null; stock: number; minStock: number; lastCost: number; trackExpiry: boolean; isActive: boolean }) {
  return {
    id: m.id, name: m.name, unit: m.unit, category: m.category, trackExpiry: m.trackExpiry, isActive: m.isActive,
    stock: fromQ(m.stock), minStock: fromQ(m.minStock), price: m.lastCost / 100,
    /** Остаток в рублях по последней цене закупки */
    value: Math.round((Math.max(0, m.stock) / 1000) * m.lastCost) / 100,
    low: m.minStock > 0 && m.stock <= m.minStock,
  };
}
