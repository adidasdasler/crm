import { Injectable } from '@nestjs/common';
import type { Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { env } from '../config';
import { AuthCtx, signAccessToken } from '../common/auth';
import { randomToken, sha256 } from '../common/crypto';
import { AppError, conflict, isUniqueError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { DEFAULT_SCHEDULE } from '../common/schemas';

const MAX_FAILED = 5;
const LOCK_MIN = 15;

export type Meta = { ip?: string; userAgent?: string };
export type Tokens = { accessToken: string; refreshToken: string; refreshExpiresAt: Date };

const RESERVED_SLUGS = new Set([
  'app', 'api', 'www', 'admin', 'mail', 'static', 'cdn', 'help', 'support', 'blog', 'b', 'demo',
]);

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async isSlugAvailable(slug: string) {
    if (RESERVED_SLUGS.has(slug)) return false;
    return !(await this.prisma.system.tenant.findUnique({ where: { slug } }));
  }

  /** Регистрация владельца: пользователь + салон + подписка TRIAL + первый мастер. */
  async register(
    dto: { email: string; password: string; name: string; phone?: string; salonName: string; slug: string; timezone: string },
    meta: Meta,
  ) {
    if (!(await this.isSlugAvailable(dto.slug))) {
      throw conflict('SLUG_TAKEN', 'Этот адрес уже занят');
    }
    const plan = await this.prisma.system.plan.findFirst({ where: { code: 'START' } });
    if (!plan) throw new AppError('NO_PLANS', 'Тарифы не настроены (запустите seed)', 500);

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    try {
      const { user, tenant, membership } = await this.prisma.system.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email: dto.email, passwordHash, name: dto.name, phone: dto.phone },
        });
        const tenant = await tx.tenant.create({
          data: { name: dto.salonName, slug: dto.slug, timezone: dto.timezone, phone: dto.phone },
        });
        const resource = await tx.resource.create({
          data: { tenantId: tenant.id, name: dto.name, phone: dto.phone, schedule: DEFAULT_SCHEDULE },
        });
        const membership = await tx.membership.create({
          data: { tenantId: tenant.id, userId: user.id, role: 'OWNER', resourceId: resource.id },
        });
        await tx.subscription.create({
          data: {
            tenantId: tenant.id,
            planId: plan.id,
            status: 'TRIAL',
            trialEndsAt: new Date(Date.now() + env.TRIAL_DAYS * 86400_000),
          },
        });
        await tx.auditLog.create({
          data: { tenantId: tenant.id, userId: user.id, action: 'tenant.register', entityType: 'Tenant', entityId: tenant.id },
        });
        return { user, tenant, membership };
      });
      const tokens = await this.issue(
        { userId: user.id, tenantId: tenant.id, role: membership.role, resourceId: membership.resourceId },
        meta,
      );
      return { tokens, user: { id: user.id, email: user.email, name: user.name }, tenant };
    } catch (e) {
      if (isUniqueError(e)) throw conflict('EMAIL_TAKEN', 'Пользователь с таким email уже существует');
      throw e;
    }
  }

  async login(dto: { email: string; password: string; tenantId?: string }, meta: Meta) {
    const db = this.prisma.system;
    const user = await db.user.findUnique({ where: { email: dto.email } });
    const invalid = new AppError('INVALID_CREDENTIALS', 'Неверный email или пароль', 401);
    if (!user || user.deletedAt) {
      // Выравниваем время ответа, чтобы не раскрывать существование email.
      await argon2.hash(dto.password).catch(() => null);
      throw invalid;
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError('ACCOUNT_LOCKED', 'Слишком много попыток. Попробуйте через 15 минут', 423);
    }
    if (!(await argon2.verify(user.passwordHash, dto.password))) {
      const attempts = user.failedLoginAttempts + 1;
      await db.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: attempts >= MAX_FAILED ? 0 : attempts,
          lockedUntil: attempts >= MAX_FAILED ? new Date(Date.now() + LOCK_MIN * 60_000) : null,
        },
      });
      throw invalid;
    }

    const memberships = await db.membership.findMany({
      where: { userId: user.id, deletedAt: null, tenant: { deletedAt: null } },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (!memberships.length) throw new AppError('NO_ACCESS', 'Вы не состоите ни в одном салоне', 403);
    const m = (dto.tenantId && memberships.find((x) => x.tenantId === dto.tenantId)) || memberships[0];

    await db.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const tokens = await this.issue(
      { userId: user.id, tenantId: m.tenantId, role: m.role, resourceId: m.resourceId },
      meta,
    );
    return {
      tokens,
      user: { id: user.id, email: user.email, name: user.name },
      tenants: memberships.map((x) => ({ ...x.tenant, role: x.role })),
    };
  }

  /** Ротация refresh-токена. Повторное использование старого токена отзывает всю цепочку. */
  async refresh(refreshToken: string, meta: Meta) {
    const db = this.prisma.system;
    const row = await db.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    const invalid = new AppError('INVALID_REFRESH', 'Сессия недействительна, войдите снова', 401);
    if (!row) throw invalid;
    if (row.revokedAt) {
      // Кто-то использует уже заменённый токен → вероятна кража. Отзываем всё семейство.
      await db.refreshToken.updateMany({
        where: { family: row.family, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw invalid;
    }
    if (row.expiresAt < new Date()) throw invalid;

    const m = await db.membership.findFirst({
      where: { userId: row.userId, tenantId: row.tenantId, deletedAt: null },
    });
    if (!m) throw invalid;
    return this.issue(
      { userId: row.userId, tenantId: m.tenantId, role: m.role, resourceId: m.resourceId },
      meta,
      { family: row.family, previousId: row.id },
    );
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return;
    const row = await this.prisma.system.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (row) {
      await this.prisma.system.refreshToken.updateMany({
        where: { family: row.family, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  async revokeAllSessions(userId: string) {
    await this.prisma.system.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async switchTenant(auth: AuthCtx, tenantId: string, meta: Meta) {
    const m = await this.prisma.system.membership.findFirst({
      where: { userId: auth.userId, tenantId, deletedAt: null },
    });
    if (!m) throw new AppError('FORBIDDEN', 'Нет доступа к салону', 403);
    return this.issue({ userId: auth.userId, tenantId, role: m.role, resourceId: m.resourceId }, meta);
  }

  async me(auth: AuthCtx) {
    const db = this.prisma.system;
    const [user, memberships] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { id: true, email: true, name: true, phone: true } }),
      db.membership.findMany({
        where: { userId: auth.userId, deletedAt: null },
        include: { tenant: { select: { id: true, name: true, slug: true, timezone: true } } },
      }),
    ]);
    const current = memberships.find((m) => m.tenantId === auth.tenantId);
    return {
      user,
      role: auth.role,
      resourceId: auth.resourceId,
      tenant: current?.tenant,
      tenants: memberships.map((m) => ({ ...m.tenant, role: m.role })),
    };
  }

  async changePassword(auth: AuthCtx, current: string, next: string) {
    const user = await this.prisma.system.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!(await argon2.verify(user.passwordHash, current))) {
      throw new AppError('INVALID_CREDENTIALS', 'Текущий пароль неверен', 400);
    }
    await this.prisma.system.user.update({
      where: { id: user.id },
      data: { passwordHash: await argon2.hash(next, { type: argon2.argon2id }) },
    });
    await this.revokeAllSessions(user.id);
  }

  private async issue(
    ctx: AuthCtx,
    meta: Meta,
    rotate?: { family: string; previousId: string },
  ): Promise<Tokens> {
    const refreshToken = randomToken(48);
    const refreshExpiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 86400_000);
    const id = randomUUID();
    await this.prisma.system.$transaction(async (tx) => {
      if (rotate) {
        // Условное обновление: если два запроса пришли одновременно, второй получит count=0.
        const r = await tx.refreshToken.updateMany({
          where: { id: rotate.previousId, revokedAt: null },
          data: { revokedAt: new Date(), replacedBy: id },
        });
        if (r.count === 0) throw new AppError('INVALID_REFRESH', 'Сессия недействительна, войдите снова', 401);
      }
      await tx.refreshToken.create({
        data: {
          id,
          userId: ctx.userId,
          tenantId: ctx.tenantId,
          tokenHash: sha256(refreshToken),
          family: rotate?.family ?? randomUUID(),
          expiresAt: refreshExpiresAt,
          ip: meta.ip,
          userAgent: meta.userAgent?.slice(0, 300),
        },
      });
    });
    return { accessToken: await signAccessToken(ctx), refreshToken, refreshExpiresAt };
  }
}

export type { Role };
