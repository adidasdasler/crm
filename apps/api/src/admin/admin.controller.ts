import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { statfs } from 'node:fs/promises';
import { z } from 'zod';
import { Auth, AuthCtx } from '../common/auth';
import { AppError, notFound } from '../common/errors';
import { Zod } from '../common/http';
import { PrismaService } from '../common/prisma.service';
import { env } from '../config';
import { DEMO_SLUG, resetDemo } from '../demo/demo';

export const adminEmails = () => env.ADMIN_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const DAY = 86400_000;

/**
 * Админ-панель владельца сервиса: здоровье, салоны, ошибки, поддержка.
 * Доступ — только пользователям с email из ADMIN_EMAILS. Данные клиентов салонов здесь не показываются:
 * только количество, без имён и телефонов.
 */
@Controller('admin')
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  private async assertAdmin(a: AuthCtx) {
    const u = await this.prisma.system.user.findUnique({ where: { id: a.userId }, select: { email: true } });
    if (!u || !adminEmails().includes(u.email.toLowerCase())) throw new AppError('FORBIDDEN', 'Только для администратора сервиса', 403);
  }

  @Get('overview')
  async overview(@Auth() a: AuthCtx) {
    await this.assertAdmin(a);
    const db = this.prisma.system;
    const now = Date.now();
    const [byStatus, tenants7, tenants30, users, bookingsToday, bookings30, online30, hb, errors24, dbSize, active] = await Promise.all([
      db.subscription.groupBy({ by: ['status'], _count: true, where: { tenant: { deletedAt: null, slug: { not: DEMO_SLUG } } } }),
      db.tenant.count({ where: { deletedAt: null, createdAt: { gte: new Date(now - 7 * DAY) } } }),
      db.tenant.count({ where: { deletedAt: null, createdAt: { gte: new Date(now - 30 * DAY) } } }),
      db.user.count({ where: { deletedAt: null } }),
      db.booking.count({ where: { createdAt: { gte: new Date(now - DAY) } } }),
      db.booking.count({ where: { createdAt: { gte: new Date(now - 30 * DAY) } } }),
      db.booking.count({ where: { createdAt: { gte: new Date(now - 30 * DAY) }, source: 'WIDGET' } }),
      db.heartbeat.findUnique({ where: { name: 'worker' } }),
      db.errorLog.count({ where: { at: { gte: new Date(now - DAY) } } }),
      db.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`.then((r) => Number(r[0]?.size ?? 0)).catch(() => 0),
      db.subscription.findMany({ where: { status: 'ACTIVE', tenant: { deletedAt: null } }, select: { billingPeriod: true, plan: { select: { priceMonthly: true, priceYearly: true } } } }),
    ]);
    const disk = await statfs(env.UPLOADS_DIR).then((s) => ({ freeGb: +((s.bavail * s.bsize) / 1e9).toFixed(1), totalGb: +((s.blocks * s.bsize) / 1e9).toFixed(1) })).catch(() => null);
    const mrr = active.reduce((s, x) => s + (x.billingPeriod === 'YEARLY' ? Math.round(x.plan.priceYearly / 12) : x.plan.priceMonthly), 0);
    return {
      version: env.APP_VERSION,
      subscriptions: Object.fromEntries(byStatus.map((x) => [x.status, x._count])),
      signups: { days7: tenants7, days30: tenants30 }, users,
      bookings: { day: bookingsToday, days30: bookings30, online30 },
      mrr,
      health: {
        workerAgeSec: hb ? Math.round((now - +hb.at) / 1000) : null,
        errors24h: errors24,
        dbMb: Math.round(dbSize / 1e6),
        disk,
      },
    };
  }

  @Get('tenants')
  async tenants(@Auth() a: AuthCtx, @Query('q') q?: string) {
    await this.assertAdmin(a);
    const db = this.prisma.system;
    const rows = await db.tenant.findMany({
      where: {
        deletedAt: null,
        ...(q?.trim() ? { OR: [{ name: { contains: q.trim(), mode: 'insensitive' } }, { slug: { contains: q.trim().toLowerCase() } }, { memberships: { some: { role: 'OWNER', user: { email: { contains: q.trim().toLowerCase() } } } } }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, name: true, slug: true, createdAt: true,
        subscription: { select: { status: true, trialEndsAt: true, currentPeriodEnd: true, plan: { select: { name: true } } } },
        memberships: { where: { role: 'OWNER', deletedAt: null }, select: { user: { select: { email: true, name: true, lastLoginAt: true } } }, take: 1 },
      },
    });
    const since = new Date(Date.now() - 30 * DAY);
    const counts = await db.booking.groupBy({ by: ['tenantId'], where: { tenantId: { in: rows.map((r) => r.id) }, createdAt: { gte: since } }, _count: true });
    const byTenant = new Map(counts.map((c) => [c.tenantId, c._count]));
    const masters = await db.resource.groupBy({ by: ['tenantId'], where: { tenantId: { in: rows.map((r) => r.id) }, deletedAt: null, isActive: true }, _count: true });
    const mastersBy = new Map(masters.map((c) => [c.tenantId, c._count]));
    return rows.map((t) => ({
      id: t.id, name: t.name, slug: t.slug, createdAt: t.createdAt, masters: mastersBy.get(t.id) ?? 0, bookings30: byTenant.get(t.id) ?? 0,
      owner: t.memberships[0]?.user ?? null,
      plan: t.subscription?.plan.name ?? null, status: t.subscription?.status ?? null,
      until: t.subscription?.status === 'TRIAL' ? t.subscription.trialEndsAt : t.subscription?.currentPeriodEnd ?? null,
    }));
  }

  /** Продлить пробный период или оплаченный срок (поддержка, компенсация за сбой) */
  @HttpCode(200)
  @Post('tenants/:id/extend')
  async extend(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(z.object({ days: z.number().int().min(1).max(365) }))) dto: { days: number }) {
    await this.assertAdmin(a);
    const db = this.prisma.system;
    const sub = await db.subscription.findUnique({ where: { tenantId: id } });
    if (!sub) throw notFound('Подписка');
    const add = (d: Date | null) => new Date(Math.max(+(d ?? 0), Date.now()) + dto.days * DAY);
    const data = sub.status === 'TRIAL' || !sub.currentPeriodEnd
      ? { status: 'TRIAL' as const, trialEndsAt: add(sub.trialEndsAt) }
      : { status: 'ACTIVE' as const, currentPeriodEnd: add(sub.currentPeriodEnd) };
    const r = await db.subscription.update({ where: { tenantId: id }, data });
    await db.auditLog.create({ data: { tenantId: id, userId: a.userId, action: 'admin.extend', entityType: 'Subscription', entityId: sub.id, after: { days: dto.days } } });
    return { status: r.status, trialEndsAt: r.trialEndsAt, currentPeriodEnd: r.currentPeriodEnd };
  }

  @Get('errors')
  async errors(@Auth() a: AuthCtx, @Query('limit') limit?: string) {
    await this.assertAdmin(a);
    const rows = await this.prisma.system.errorLog.findMany({ orderBy: { at: 'desc' }, take: Math.min(200, Number(limit) || 50) });
    return rows.map((r) => ({ ...r, id: String(r.id) }));
  }

  @HttpCode(200)
  @Post('demo/reset')
  async demoReset(@Auth() a: AuthCtx) {
    await this.assertAdmin(a);
    return { reset: await resetDemo(this.prisma.system) };
  }
}
