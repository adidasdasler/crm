import {
  CanActivate, createParamDecorator, ExecutionContext, Injectable, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import type { Request } from 'express';
import { jwtVerify, SignJWT } from 'jose';
import { DEMO_SLUG } from '../demo/demo';
import { env } from '../config';
import { AppError, forbidden } from './errors';
import { Perm, PermissionOverrides, resolvePermissions } from './permissions';
import { PrismaService } from './prisma.service';

export type AuthCtx = {
  userId: string;
  tenantId: string;
  role: Role;
  /** Для MASTER — его Resource.id */
  resourceId: string | null;
  /** Права с учётом настроек салона (заполняет AuthGuard) */
  perms?: ReadonlySet<Perm>;
  /** Демо-салон с общим входом (заполняет AuthGuard) */
  demo?: boolean;
};

/** Есть ли у пользователя право. Владелец может всё. */
export const can = (a: AuthCtx, p: Perm) => a.role === 'OWNER' || !!a.perms?.has(p);

const key = new TextEncoder().encode(env.JWT_SECRET);

export async function signAccessToken(ctx: AuthCtx): Promise<string> {
  return new SignJWT({ tid: ctx.tenantId, role: ctx.role, rid: ctx.resourceId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(ctx.userId)
    .setIssuedAt()
    .setIssuer('salon')
    .setExpirationTime(`${env.JWT_ACCESS_TTL_MIN}m`)
    .sign(key);
}

export async function verifyAccessToken(token: string): Promise<AuthCtx> {
  const { payload } = await jwtVerify(token, key, { issuer: 'salon', algorithms: ['HS256'] });
  return {
    userId: payload.sub!,
    tenantId: payload.tid as string,
    role: payload.role as Role,
    resourceId: (payload.rid as string | null) ?? null,
  };
}

export const PUBLIC = 'isPublic';
export const Public = () => SetMetadata(PUBLIC, true);
export const ROLES = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);
export const PERMS = 'perms';
/** Эндпоинт доступен, если у роли есть хотя бы одно из прав */
export const Can = (...perms: Perm[]) => SetMetadata(PERMS, perms);
const NO_DEMO = 'noDemo';
/** Действие закрыто в демо-салоне: удаление, пароли, сотрудники, публичные данные, оплата */
export const NoDemo = () => SetMetadata(NO_DEMO, true);
export const demoBlocked = () => new AppError('DEMO_READONLY', 'В демо это недоступно. Зарегистрируйтесь — 14 дней бесплатно, и всё заработает', 403);

/** Настройки прав салона кэшируются на 10 секунд, чтобы не читать БД на каждый запрос */
const permCache = new Map<string, { at: number; v: PermissionOverrides | undefined }>();
export const invalidatePermissions = (tenantId: string) => permCache.delete(tenantId);
/** Активен ли доступ пользователя к салону (не удалён аккаунт, сотрудник или салон) — кэш на 10 секунд */
const accessCache = new Map<string, { at: number; ok: boolean; demo: boolean; blocked: boolean }>();
/** Сбросить кэш доступа всех сотрудников салона (блокировка, удаление) */
export const invalidateTenantAccess = (tenantId: string) => { for (const k of accessCache.keys()) if (k.endsWith(`:${tenantId}`)) accessCache.delete(k); };
export const invalidateAccess = (userId: string) => { for (const k of accessCache.keys()) if (k.startsWith(`${userId}:`)) accessCache.delete(k); };

/** Роли, которые управляют салоном (всё, кроме мастера). */
export const STAFF_ADMIN: Role[] = ['OWNER', 'MANAGER', 'ADMIN'];

/**
 * Глобальный guard. Токен берётся из:
 *  - Authorization: Bearer ... (мобильное приложение)
 *  - cookie access_token (веб). Для cookie-авторизации мутирующие запросы
 *    обязаны иметь заголовок X-Requested-With — защита от CSRF
 *    (кросс-доменный сайт не может его отправить без разрешения CORS).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  private async access(userId: string, tenantId: string): Promise<{ ok: boolean; demo: boolean; blocked: boolean }> {
    const key = `${userId}:${tenantId}`;
    const hit = accessCache.get(key);
    if (hit && Date.now() - hit.at < 10_000) return hit;
    const m = await this.prisma.system.membership.findFirst({
      where: { userId, tenantId, deletedAt: null, user: { deletedAt: null }, tenant: { deletedAt: null } }, select: { tenant: { select: { slug: true, blockedAt: true } } },
    });
    const v = { at: Date.now(), ok: !!m, demo: m?.tenant.slug === DEMO_SLUG, blocked: !!m?.tenant.blockedAt };
    accessCache.set(key, v);
    return v;
  }

  private async overrides(tenantId: string): Promise<PermissionOverrides | undefined> {
    const hit = permCache.get(tenantId);
    if (hit && Date.now() - hit.at < 10_000) return hit.v;
    const t = await this.prisma.system.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
    const v = (t?.settings as { permissions?: PermissionOverrides } | null)?.permissions;
    permCache.set(tenantId, { at: Date.now(), v });
    return v;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { auth?: AuthCtx }>();
    const header = req.headers.authorization;
    let token: string | undefined;
    if (header?.startsWith('Bearer ')) {
      token = header.slice(7);
    } else if (req.cookies?.access_token) {
      token = req.cookies.access_token;
      const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      if (mutating && !req.headers['x-requested-with']) {
        throw new AppError('CSRF', 'Отсутствует заголовок X-Requested-With', 403);
      }
    }
    if (!token) throw new AppError('UNAUTHORIZED', 'Требуется вход', 401);
    try {
      req.auth = await verifyAccessToken(token);
    } catch {
      throw new AppError('TOKEN_EXPIRED', 'Сессия истекла', 401);
    }

    // Токен ещё действует, но аккаунт удалён или сотрудника убрали из салона — сессия закончена
    const access = await this.access(req.auth.userId, req.auth.tenantId);
    if (!access.ok) throw new AppError('UNAUTHORIZED', 'Сессия завершена, войдите снова', 401);
    if (access.blocked) throw new AppError('TENANT_BLOCKED', `Салон заблокирован. Напишите в поддержку MioFlow: ${env.SUPPORT_EMAIL}`, 403);
    req.auth.demo = access.demo;
    if (access.demo && this.reflector.getAllAndOverride<boolean>(NO_DEMO, targets)) throw demoBlocked();

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, targets);
    if (roles?.length && !roles.includes(req.auth.role)) throw forbidden();
    req.auth.perms = req.auth.role === 'OWNER' ? undefined : resolvePermissions(req.auth.role, await this.overrides(req.auth.tenantId));
    const perms = this.reflector.getAllAndOverride<Perm[]>(PERMS, targets);
    if (perms?.length && !perms.some((p) => can(req.auth!, p))) throw forbidden();
    return true;
  }
}

export const Auth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthCtx => ctx.switchToHttp().getRequest().auth,
);
