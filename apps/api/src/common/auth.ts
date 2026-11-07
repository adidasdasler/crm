import {
  CanActivate, createParamDecorator, ExecutionContext, Injectable, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import type { Request } from 'express';
import { jwtVerify, SignJWT } from 'jose';
import { env } from '../config';
import { AppError, forbidden } from './errors';

export type AuthCtx = {
  userId: string;
  tenantId: string;
  role: Role;
  /** Для MASTER — его Resource.id */
  resourceId: string | null;
};

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
  constructor(private readonly reflector: Reflector) {}

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

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, targets);
    if (roles?.length && !roles.includes(req.auth.role)) throw forbidden();
    return true;
  }
}

export const Auth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthCtx => ctx.switchToHttp().getRequest().auth,
);
