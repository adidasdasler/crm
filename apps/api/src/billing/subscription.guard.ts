import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthCtx } from '../common/auth';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { subscriptionStatus } from './billing.service';

/**
 * Подписка истекла (EXPIRED) → CRM работает только на чтение: можно смотреть данные и оплатить,
 * но нельзя создавать/менять записи. Данные не удаляются.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { auth?: AuthCtx }>();
    if (!req.auth || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    const path = req.path.replace(/^\/v1/, '');
    if (/^\/(auth|billing|me)\b/.test(path)) return true;
    if ((await subscriptionStatus(this.prisma.system, req.auth.tenantId)) === 'EXPIRED') {
      throw new AppError('SUBSCRIPTION_EXPIRED', 'Подписка закончилась. Оплатите её в разделе «Ещё → Подписка», чтобы снова вносить изменения', 402);
    }
    return true;
  }
}
