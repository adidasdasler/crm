import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as argon2 from 'argon2';
import { Throttle } from '@nestjs/throttler';
import { statfs } from 'node:fs/promises';
import { z } from 'zod';
import { Public } from '../common/auth';
import { cookieSecure } from '../config';
import { open } from '../common/secret-box';
import { ADMIN_COOKIE, ADMIN_TTL_H, AdminCtx, AdminGuard, ipOf, signAdmin } from './admin-auth';
import { verifyTotp } from './totp';
import { AppError, notFound } from '../common/errors';
import { Zod } from '../common/http';
import { PrismaService } from '../common/prisma.service';
import { env } from '../config';
import { DEMO_SLUG, resetDemo } from '../demo/demo';

const DAY = 86400_000;

/** Задачи для сервера, которые умеет выполнять deploy/scripts/admin-agent.sh — и только они */
export const TASK_KINDS = {
  status: 'Состояние контейнеров и диска',
  logs_api: 'Последние логи API',
  logs_worker: 'Последние логи воркера',
  restart: 'Перезапустить API и воркер',
  backup: 'Сделать бэкап сейчас',
  test_restore: 'Проверить, что бэкап восстанавливается',
  deploy: 'Обновить до последней версии',
} as const;
type Admin = Request & { admin: AdminCtx };
const MAX_FAILED = 5;

/** Вход в панель владельца сервиса (mioflow.ru/admin) */
@Public()
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly prisma: PrismaService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(@Body(new Zod(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200), code: z.string().max(12) }))) dto: { email: string; password: string; code: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const db = this.prisma.system;
    const invalid = new AppError('ADMIN_INVALID', 'Неверный email, пароль или код', 401);
    const a = await db.adminUser.findUnique({ where: { email: dto.email } });
    if (!a) { await argon2.hash(dto.password).catch(() => null); throw invalid; }
    if (a.lockedUntil && a.lockedUntil > new Date()) throw new AppError('ACCOUNT_LOCKED', 'Слишком много попыток. Попробуйте через 30 минут', 423);
    const ok = (await argon2.verify(a.passwordHash, dto.password)) && verifyTotp(open(a.totpSecretEnc), dto.code);
    if (!ok) {
      const n = a.failedAttempts + 1;
      await db.adminUser.update({ where: { id: a.id }, data: { failedAttempts: n >= MAX_FAILED ? 0 : n, lockedUntil: n >= MAX_FAILED ? new Date(Date.now() + 30 * 60_000) : null } });
      throw invalid;
    }
    await db.adminUser.update({ where: { id: a.id }, data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ipOf(req) } });
    res.cookie(ADMIN_COOKIE, await signAdmin({ id: a.id, email: a.email }), { httpOnly: true, secure: cookieSecure, sameSite: 'strict', path: '/v1/admin', maxAge: ADMIN_TTL_H * 3600_000 });
    return { email: a.email };
  }

  @HttpCode(200)
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(ADMIN_COOKIE, { path: '/v1/admin' });
    return { ok: true };
  }
}

/**
 * Панель владельца сервиса: здоровье, бизнес, салоны, ошибки, управление сервером.
 * Данные клиентов салонов здесь не показываются — только количество.
 */
@Public()
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  me(@Req() req: Admin) {
    return { email: req.admin.email };
  }

  @Get('tasks')
  async tasks() {
    const rows = await this.prisma.system.adminTask.findMany({ orderBy: { id: 'desc' }, take: 30 });
    const hb = await this.prisma.system.heartbeat.findUnique({ where: { name: 'admin-agent' } });
    return {
      kinds: TASK_KINDS,
      // Скрипт на сервере отмечается раз в минуту; если давно не отмечался — кнопки не сработают
      agentAgeSec: hb ? Math.round((Date.now() - +hb.at) / 1000) : null,
      tasks: rows.map((r) => ({ ...r, id: String(r.id), title: TASK_KINDS[r.kind as keyof typeof TASK_KINDS] ?? r.kind })),
    };
  }

  @HttpCode(200)
  @Post('tasks')
  async addTask(@Req() req: Admin, @Body(new Zod(z.object({ kind: z.enum(Object.keys(TASK_KINDS) as [keyof typeof TASK_KINDS]) }))) dto: { kind: keyof typeof TASK_KINDS }) {
    const db = this.prisma.system;
    // Одна и та же задача не встаёт в очередь дважды
    const dup = await db.adminTask.findFirst({ where: { kind: dto.kind, status: { in: ['PENDING', 'RUNNING'] } } });
    if (dup) return { ...dup, id: String(dup.id) };
    const t = await db.adminTask.create({ data: { kind: dto.kind, requestedBy: req.admin.email } });
    return { ...t, id: String(t.id) };
  }

  @Get('overview')
  async overview() {
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
  async tenants(@Query('q') q?: string, @Query('deleted') deleted?: string) {
    const db = this.prisma.system;
    const rows = await db.tenant.findMany({
      where: {
        ...(deleted ? { deletedAt: { not: null }, slug: { startsWith: 'removed-' } } : { deletedAt: null }),
        ...(q?.trim() ? { OR: [{ name: { contains: q.trim(), mode: 'insensitive' } }, { slug: { contains: q.trim().toLowerCase() } }, { memberships: { some: { role: 'OWNER', user: { email: { contains: q.trim().toLowerCase() } } } } }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, name: true, slug: true, deletedSlug: true, createdAt: true, blockedAt: true, deletedAt: true,
        subscription: { select: { status: true, trialEndsAt: true, currentPeriodEnd: true, plan: { select: { name: true } } } },
        memberships: { where: { role: 'OWNER' }, orderBy: { createdAt: 'asc' }, select: { user: { select: { email: true, name: true, lastLoginAt: true } } }, take: 1 },
      },
    });
    const since = new Date(Date.now() - 30 * DAY);
    const counts = await db.booking.groupBy({ by: ['tenantId'], where: { tenantId: { in: rows.map((r) => r.id) }, createdAt: { gte: since } }, _count: true });
    const byTenant = new Map(counts.map((c) => [c.tenantId, c._count]));
    const masters = await db.resource.groupBy({ by: ['tenantId'], where: { tenantId: { in: rows.map((r) => r.id) }, deletedAt: null, isActive: true }, _count: true });
    const mastersBy = new Map(masters.map((c) => [c.tenantId, c._count]));
    return rows.map((t) => ({
      id: t.id, name: t.name, slug: t.deletedSlug ?? t.slug, createdAt: t.createdAt, blocked: !!t.blockedAt, deletedAt: t.deletedAt, masters: mastersBy.get(t.id) ?? 0, bookings30: byTenant.get(t.id) ?? 0,
      owner: t.memberships[0]?.user ?? null,
      plan: t.subscription?.plan.name ?? null, status: t.subscription?.status ?? null,
      until: t.subscription?.status === 'TRIAL' ? t.subscription.trialEndsAt : t.subscription?.currentPeriodEnd ?? null,
    }));
  }

  /** Продлить пробный период или оплаченный срок (поддержка, компенсация за сбой) */
  @HttpCode(200)
  @Post('tenants/:id/extend')
  async extend(@Req() req: Admin, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(z.object({ days: z.number().int().min(1).max(365) }))) dto: { days: number }) {
    const db = this.prisma.system;
    const sub = await db.subscription.findUnique({ where: { tenantId: id } });
    if (!sub) throw notFound('Подписка');
    const add = (d: Date | null) => new Date(Math.max(+(d ?? 0), Date.now()) + dto.days * DAY);
    const data = sub.status === 'TRIAL' || !sub.currentPeriodEnd
      ? { status: 'TRIAL' as const, trialEndsAt: add(sub.trialEndsAt) }
      : { status: 'ACTIVE' as const, currentPeriodEnd: add(sub.currentPeriodEnd) };
    const r = await db.subscription.update({ where: { tenantId: id }, data });
    await db.auditLog.create({ data: { tenantId: id, action: 'admin.extend', entityType: 'Subscription', entityId: sub.id, after: { days: dto.days, by: req.admin.email } } });
    return { status: r.status, trialEndsAt: r.trialEndsAt, currentPeriodEnd: r.currentPeriodEnd };
  }

  @Get('errors')
  async errors(@Query('limit') limit?: string) {
    const rows = await this.prisma.system.errorLog.findMany({ orderBy: { at: 'desc' }, take: Math.min(200, Number(limit) || 50) });
    return rows.map((r) => ({ ...r, id: String(r.id) }));
  }

  @HttpCode(200)
  @Post('demo/reset')
  async demoReset() {
    return { reset: await resetDemo(this.prisma.system) };
  }
}
