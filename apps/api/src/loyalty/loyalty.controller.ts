import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { audit } from '../common/audit';
import { Auth, AuthCtx, Can } from '../common/auth';
import { AppError, notFound } from '../common/errors';
import { Zod } from '../common/http';
import { PrismaService } from '../common/prisma.service';
import { uuid } from '../common/schemas';
import { readSettings } from '../common/tenant-settings';
import { bonusForTopup, expirePasses, refund, topup } from './loyalty';

const rubles = z.number().positive().max(10_000_000);
const kop = (r: number) => Math.round(r * 100);
const method = z.enum(['cash', 'card', 'transfer', 'other']).optional();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const topupSchema = z.object({
  amount: rubles,
  /** Бонус вручную (₽). Если не указан — по ступеням салона */
  bonus: z.number().min(0).max(10_000_000).optional(),
  method, note: z.string().trim().max(300).optional(),
});
const refundSchema = z.object({ amount: rubles, method, note: z.string().trim().max(300).optional() });
const planSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullish(),
  kind: z.enum(['VISITS', 'UNLIMITED']),
  visits: z.number().int().min(1).max(500).nullish(),
  validityDays: z.number().int().min(1).max(730),
  price: z.number().min(0).max(10_000_000),
  serviceIds: z.array(uuid).max(100).optional(),
  timeRule: z.object({ days: z.array(z.number().int().min(1).max(7)).max(7).optional(), from: hhmm.optional(), to: hhmm.optional() }).nullish(),
  isPublic: z.boolean().optional(),
  isActive: z.boolean().optional(),
}).refine((p) => (p.kind === 'VISITS' ? !!p.visits : !p.visits), { error: 'Для абонемента на визиты укажите их количество' })
  .refine((p) => !p.timeRule?.from || !p.timeRule?.to || p.timeRule.from < p.timeRule.to, { error: 'Начало окна должно быть раньше конца' });
const sellSchema = z.object({ planId: uuid, method, startsAt: z.coerce.date().optional() });

const ENTRY_LABEL: Record<string, string> = { TOPUP: 'Пополнение', CHARGE: 'Оплата визита', REFUND: 'Возврат денег', RETURN: 'Возврат за визит', ADJUST: 'Корректировка' };
const METHOD_LABEL: Record<string, string> = { cash: 'наличные', card: 'карта', transfer: 'перевод', other: 'другое' };

/**
 * Депозиты и абонементы клиентов. Деньги принимает салон (наличные, карта, перевод) и выдаёт чек сам —
 * MioFlow ведёт только учёт и автоматически списывает визиты.
 */
@Controller()
export class LoyaltyController {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Баланс клиента ───
  @Can('finance.manage', 'customers.view')
  @Get('customers/:id/account')
  account(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      await expirePasses(tx, id);
      const c = await tx.customer.findFirst({ where: { id, deletedAt: null }, select: { balance: true, bonus: true } });
      if (!c) throw notFound('Клиент');
      const [entries, passes, t] = await Promise.all([
        tx.accountEntry.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
        tx.customerPass.findMany({ where: { customerId: id }, orderBy: [{ status: 'asc' }, { expiresAt: 'asc' }], take: 30 }),
        tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { settings: true } }),
      ]);
      return {
        money: c.balance / 100, bonus: c.bonus / 100, total: (c.balance + c.bonus) / 100,
        tiers: readSettings(t.settings).depositTiers.map((x) => ({ amount: x.amount / 100, bonus: x.bonus / 100 })),
        entries: entries.map((e) => ({
          id: e.id, type: e.type, label: ENTRY_LABEL[e.type], money: e.money / 100, bonus: e.bonus / 100,
          method: e.method ? METHOD_LABEL[e.method] ?? e.method : null, bookingId: e.bookingId, note: e.note, createdAt: e.createdAt,
        })),
        passes: passes.map(passView),
      };
    });
  }

  @Can('finance.manage')
  @Post('customers/:id/account/topup')
  topup(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(topupSchema)) dto: z.infer<typeof topupSchema>) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { settings: true } });
      const money = kop(dto.amount);
      const bonus = dto.bonus !== undefined ? kop(dto.bonus) : bonusForTopup(money, readSettings(t.settings).depositTiers);
      const r = await topup(tx, a, id, { money, bonus, method: dto.method, note: dto.note });
      await audit(tx, a, 'account.topup', 'Customer', id, null, { money, bonus, method: dto.method });
      return { money: r.balance / 100, bonus: r.bonus / 100, added: { money: money / 100, bonus: bonus / 100 } };
    });
  }

  @Can('finance.manage')
  @Post('customers/:id/account/refund')
  refund(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(refundSchema)) dto: z.infer<typeof refundSchema>) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const r = await refund(tx, a, id, { money: kop(dto.amount), method: dto.method, note: dto.note });
      await audit(tx, a, 'account.refund', 'Customer', id, null, { money: kop(dto.amount) });
      return { money: r.balance / 100, bonus: r.bonus / 100 };
    });
  }

  // ─── Виды абонементов ───
  @Get('passes/plans')
  plans(@Auth() a: AuthCtx) {
    return this.prisma.withTenant(a.tenantId, async (tx) =>
      (await tx.passPlan.findMany({ orderBy: [{ isActive: 'desc' }, { price: 'asc' }] })).map(planView),
    );
  }

  @Can('finance.manage')
  @Post('passes/plans')
  createPlan(@Auth() a: AuthCtx, @Body(new Zod(planSchema)) dto: z.infer<typeof planSchema>) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      await this.checkServices(tx, dto.serviceIds);
      const p = await tx.passPlan.create({ data: { ...this.planData(dto), tenantId: a.tenantId } });
      await audit(tx, a, 'pass.plan.create', 'PassPlan', p.id, null, p);
      return planView(p);
    });
  }

  @Can('finance.manage')
  @Patch('passes/plans/:id')
  updatePlan(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(planSchema)) dto: z.infer<typeof planSchema>) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const before = await tx.passPlan.findUnique({ where: { id } });
      if (!before) throw notFound('Абонемент');
      await this.checkServices(tx, dto.serviceIds);
      // Проданные абонементы не меняются: условия скопированы в момент продажи
      const p = await tx.passPlan.update({ where: { id }, data: this.planData(dto) });
      await audit(tx, a, 'pass.plan.update', 'PassPlan', id, before, p);
      return planView(p);
    });
  }

  @Can('finance.manage')
  @Delete('passes/plans/:id')
  archivePlan(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      if (!(await tx.passPlan.findUnique({ where: { id } }))) throw notFound('Абонемент');
      await tx.passPlan.update({ where: { id }, data: { isActive: false } });
      await audit(tx, a, 'pass.plan.archive', 'PassPlan', id);
      return { ok: true };
    });
  }

  // ─── Продажа и отмена ───
  @Can('finance.manage')
  @Post('customers/:id/passes')
  sell(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(sellSchema)) dto: z.infer<typeof sellSchema>) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      if (!(await tx.customer.findFirst({ where: { id, deletedAt: null }, select: { id: true } }))) throw notFound('Клиент');
      const plan = await tx.passPlan.findFirst({ where: { id: dto.planId, isActive: true } });
      if (!plan) throw notFound('Абонемент');
      const startsAt = dto.startsAt ?? new Date();
      const p = await tx.customerPass.create({
        data: {
          tenantId: a.tenantId, customerId: id, planId: plan.id, name: plan.name, kind: plan.kind,
          visitsTotal: plan.visits, visitsLeft: plan.visits, serviceIds: plan.serviceIds, timeRule: plan.timeRule ?? undefined,
          price: plan.price, method: dto.method, startsAt, expiresAt: new Date(+startsAt + plan.validityDays * 86400_000), userId: a.userId,
        },
      });
      await audit(tx, a, 'pass.sell', 'CustomerPass', p.id, null, { customerId: id, planId: plan.id, price: plan.price });
      return passView(p);
    });
  }

  @Can('finance.manage')
  @Post('passes/:id/cancel')
  cancel(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const p = await tx.customerPass.findUnique({ where: { id } });
      if (!p) throw notFound('Абонемент');
      if (p.status !== 'ACTIVE') throw new AppError('VALIDATION_ERROR', 'Абонемент уже не активен');
      const r = await tx.customerPass.update({ where: { id }, data: { status: 'CANCELLED' } });
      await audit(tx, a, 'pass.cancel', 'CustomerPass', id);
      return passView(r);
    });
  }

  private planData(dto: z.infer<typeof planSchema>) {
    return {
      name: dto.name, description: dto.description ?? null, kind: dto.kind, visits: dto.kind === 'VISITS' ? dto.visits! : null,
      validityDays: dto.validityDays, price: kop(dto.price), serviceIds: dto.serviceIds ?? [],
      timeRule: dto.timeRule && (dto.timeRule.days?.length || dto.timeRule.from || dto.timeRule.to) ? dto.timeRule : undefined,
      isPublic: dto.isPublic ?? true, isActive: dto.isActive ?? true,
    };
  }

  private async checkServices(tx: Parameters<Parameters<PrismaService['withTenant']>[1]>[0], ids?: string[]) {
    if (ids?.length && (await tx.service.count({ where: { id: { in: ids }, deletedAt: null } })) !== new Set(ids).size) throw notFound('Услуга');
  }
}

export function planView(p: { id: string; name: string; description: string | null; kind: string; visits: number | null; validityDays: number; price: number; serviceIds: string[]; timeRule: unknown; isPublic: boolean; isActive: boolean }) {
  return { ...p, price: p.price / 100 };
}

function passView(p: { id: string; name: string; kind: string; visitsTotal: number | null; visitsLeft: number | null; serviceIds: string[]; timeRule: unknown; price: number; method: string | null; startsAt: Date; expiresAt: Date; status: string; createdAt: Date }) {
  return { ...p, price: p.price / 100, method: p.method ? METHOD_LABEL[p.method] ?? p.method : null };
}
