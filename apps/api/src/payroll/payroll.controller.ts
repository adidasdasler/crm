import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { audit } from '../common/audit';
import { Auth, AuthCtx, Can, can } from '../common/auth';
import { AppError, notFound } from '../common/errors';
import { Zod } from '../common/http';
import { PrismaService } from '../common/prisma.service';
import { calcPay, payRuleSchema, PayRule } from './payroll';

const query = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

@Controller('payroll')
export class PayrollController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Расчёт за период. С правом «Депозиты и деньги» — все мастера; мастер без права видит только себя.
   */
  @Get()
  report(@Auth() a: AuthCtx, @Query(new Zod(query)) q: z.infer<typeof query>) {
    const all = can(a, 'finance.manage');
    if (!all && !a.resourceId) throw new AppError('FORBIDDEN', 'Нет доступа к расчёту зарплаты', 403);
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const { timezone: tz } = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { timezone: true } });
      const from = DateTime.fromISO(q.from, { zone: tz }).startOf('day');
      const to = DateTime.fromISO(q.to, { zone: tz }).plus({ days: 1 }).startOf('day');
      const days = Math.round(to.diff(from, 'days').days);
      if (!from.isValid || !to.isValid || days < 1 || days > 92) throw new AppError('VALIDATION_ERROR', 'Период — от 1 до 92 дней');

      const masters = await tx.resource.findMany({
        where: { deletedAt: null, ...(all ? {} : { id: a.resourceId! }) },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, color: true, payRule: true, isActive: true },
      });
      const bookings = await tx.booking.findMany({
        where: { status: 'COMPLETED', resourceId: { in: masters.map((m) => m.id) }, startsAt: { gte: from.toJSDate(), lt: to.toJSDate() } },
        select: { id: true, resourceId: true, price: true, startsAt: true },
      });
      // Себестоимость материалов по каждой записи (списание минус возвраты)
      const moves = await tx.stockMovement.findMany({
        where: { bookingId: { in: bookings.map((b) => b.id) }, type: { in: ['SERVICE', 'RETURN'] } },
        select: { bookingId: true, qty: true, costPerUnit: true },
      });
      const matByBooking = new Map<string, number>();
      for (const m of moves) matByBooking.set(m.bookingId!, (matByBooking.get(m.bookingId!) ?? 0) - Math.round((m.qty / 1000) * m.costPerUnit));

      const rows = masters
        .map((m) => calcPay(m, bookings.filter((b) => b.resourceId === m.id).map((b) => ({
          price: b.price, materials: Math.max(0, matByBooking.get(b.id) ?? 0),
          day: DateTime.fromJSDate(b.startsAt).setZone(tz).toISODate()!,
        })), days))
        // Неактивных мастеров без визитов за период не показываем
        .filter((r, i) => masters[i].isActive || r.visits > 0);
      return { from: q.from, to: q.to, days, masters: rows, total: rows.reduce((s, r) => s + r.total, 0) };
    });
  }

  @Can('finance.manage')
  @Put('rules/:resourceId')
  setRule(@Auth() a: AuthCtx, @Param('resourceId', ParseUUIDPipe) id: string, @Body(new Zod(payRuleSchema)) rule: PayRule) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const r = await tx.resource.findFirst({ where: { id, deletedAt: null } });
      if (!r) throw notFound('Мастер');
      await tx.resource.update({ where: { id }, data: { payRule: rule } });
      await audit(tx, a, 'payroll.rule', 'Resource', id, r.payRule, rule);
      return rule;
    });
  }
}
