import { Controller, Get } from '@nestjs/common';
import { Auth, AuthCtx, Public } from '../common/auth';
import { PrismaService } from '../common/prisma.service';

/** Тарифы и подписка. Оплата через ЮKassa — этап 2 (docs/ROADMAP.md). */
@Controller('billing')
export class BillingController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('plans')
  plans() {
    return this.prisma.app.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  }

  @Get('subscription')
  async subscription(@Auth() a: AuthCtx) {
    const s = await this.prisma.withTenant(a.tenantId, (tx) =>
      tx.subscription.findUnique({ where: { tenantId: a.tenantId }, include: { plan: true } }),
    );
    if (!s) return null;
    const until = s.status === 'TRIAL' ? s.trialEndsAt : s.currentPeriodEnd;
    return { ...s, daysLeft: until ? Math.max(0, Math.ceil((+until - Date.now()) / 86400_000)) : null };
  }
}
