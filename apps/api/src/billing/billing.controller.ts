import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Auth, AuthCtx, Public, Roles } from '../common/auth';
import { AppError, notFound } from '../common/errors';
import { Zod } from '../common/http';
import { PrismaService } from '../common/prisma.service';
import { isProd, paymentProvider } from '../config';
import { BillingService } from './billing.service';
import { getProvider, isYookassaIp } from './providers';

const paySchema = z.object({ planCode: z.string().min(1).max(32), period: z.enum(['MONTHLY', 'YEARLY']).default('MONTHLY') });

@Controller()
export class BillingController {
  constructor(private readonly prisma: PrismaService, private readonly billing: BillingService) {}

  @Public()
  @Get('billing/plans')
  plans() {
    return this.prisma.app.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  }

  @Get('billing/subscription')
  async subscription(@Auth() a: AuthCtx) {
    const s = await this.prisma.withTenant(a.tenantId, (tx) =>
      tx.subscription.findUnique({ where: { tenantId: a.tenantId }, include: { plan: true } }),
    );
    if (!s) return null;
    const until = s.status === 'TRIAL' ? s.trialEndsAt : s.currentPeriodEnd;
    return {
      ...s,
      until,
      daysLeft: until ? Math.max(0, Math.ceil((+until - Date.now()) / 86400_000)) : null,
      paymentsEnabled: !!getProvider(),
    };
  }

  @Roles('OWNER')
  @Get('billing/payments')
  payments(@Auth() a: AuthCtx) {
    return this.prisma.withTenant(a.tenantId, (tx) =>
      tx.payment.findMany({ orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, amount: true, status: true, billingPeriod: true, paidAt: true, createdAt: true } }),
    );
  }

  @Roles('OWNER')
  @Get('billing/payments/:id')
  async payment(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string) {
    const p = await this.prisma.withTenant(a.tenantId, (tx) => tx.payment.findUnique({ where: { id } }));
    if (!p) throw notFound('Платёж');
    // Если вебхук ещё не дошёл — спросим статус у провайдера сами.
    if (p.status === 'PENDING' && p.externalId && p.provider === 'yookassa') await this.sync(p.id, p.externalId);
    return this.prisma.withTenant(a.tenantId, (tx) =>
      tx.payment.findUniqueOrThrow({ where: { id }, select: { id: true, amount: true, status: true, billingPeriod: true, paidAt: true } }),
    );
  }

  /** Создать ссылку на оплату (оплата вручную каждый месяц/год, без автосписаний). */
  @Roles('OWNER')
  @Post('billing/pay')
  async pay(@Auth() a: AuthCtx, @Body(new Zod(paySchema)) dto: z.infer<typeof paySchema>) {
    const p = await this.billing.createPaymentLink(a.tenantId, dto.planCode, dto.period);
    return { paymentId: p.id, amount: p.amount, confirmationUrl: p.confirmationUrl };
  }

  /** Вебхук ЮKassa. Телу не доверяем: проверяем IP и перезапрашиваем статус платежа у ЮKassa. */
  @Public()
  @HttpCode(200)
  @Post('webhooks/yookassa')
  async yookassa(@Req() req: Request, @Body() body: { event?: string; object?: { id?: string; metadata?: { paymentId?: string } } }) {
    if (!isYookassaIp(req.ip ?? '')) throw new AppError('FORBIDDEN', 'forbidden', 403);
    const externalId = body.object?.id;
    if (!externalId) return { ok: true };
    const p = await this.prisma.system.payment.findUnique({ where: { externalId } });
    if (p) await this.sync(p.id, externalId);
    return { ok: true };
  }

  /** Тестовая оплата — только для PAYMENT_PROVIDER=mock и не в production. */
  @Public()
  @Get('billing/mock/:id')
  async mockInfo(@Param('id', ParseUUIDPipe) id: string) {
    this.assertMock();
    const p = await this.prisma.system.payment.findUnique({ where: { id }, select: { id: true, amount: true, status: true, billingPeriod: true } });
    if (!p) throw notFound('Платёж');
    return p;
  }

  @Public()
  @HttpCode(200)
  @Post('billing/mock/:id/succeed')
  async mockSucceed(@Param('id', ParseUUIDPipe) id: string) {
    this.assertMock();
    await this.billing.markSucceeded(id);
    return { ok: true };
  }

  private assertMock() {
    if (isProd || paymentProvider !== 'mock') throw notFound();
  }

  private async sync(paymentId: string, externalId: string) {
    const provider = getProvider();
    if (!provider) return;
    const remote = await provider.get(externalId).catch(() => null);
    if (remote?.status === 'succeeded') await this.billing.markSucceeded(paymentId, remote.paidAt);
    else if (remote?.status === 'canceled') await this.billing.markCanceled(paymentId);
  }
}
