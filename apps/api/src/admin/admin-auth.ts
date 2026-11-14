/**
 * Вход в панель владельца сервиса. Отдельно от пользователей салонов:
 * свои аккаунты (AdminUser), пароль + одноразовый код из приложения-аутентификатора,
 * своя cookie на 8 часов. Аккаунт салона сюда не пускает ни при каких правах.
 */
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { env } from '../config';

export const ADMIN_COOKIE = 'mioflow_admin';
export const ADMIN_TTL_H = 8;
const key = () => createHash('sha256').update(`${env.JWT_SECRET}:mioflow-admin:v1`).digest();

export type AdminCtx = { id: string; email: string };

export async function signAdmin(a: AdminCtx) {
  return new SignJWT({ email: a.email }).setProtectedHeader({ alg: 'HS256' }).setSubject(a.id).setAudience('mioflow-admin')
    .setIssuedAt().setExpirationTime(`${ADMIN_TTL_H}h`).sign(key());
}

/** Список разрешённых IP для панели (необязательно): ADMIN_ALLOWED_IPS=1.2.3.4,5.6.7.8 */
const allowedIp = (ip: string) => {
  const list = (env.ADMIN_ALLOWED_IPS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return !list.length || list.includes(ip.replace(/^::ffff:/, ''));
};

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request & { admin?: AdminCtx }>();
    if (!allowedIp(req.ip ?? '')) throw new AppError('FORBIDDEN', 'Доступ к панели с этого адреса закрыт', 403);
    // Защита от подделки запросов: изменяющие запросы — только из нашего интерфейса
    if (!['GET', 'HEAD'].includes(req.method) && !req.headers['x-requested-with']) throw new AppError('CSRF', 'Отсутствует заголовок X-Requested-With', 403);
    const token = req.cookies?.[ADMIN_COOKIE] as string | undefined;
    if (!token) throw new AppError('ADMIN_LOGIN', 'Войдите в панель', 401);
    try {
      const { payload } = await jwtVerify(token, key(), { audience: 'mioflow-admin' });
      const admin = await this.prisma.system.adminUser.findUnique({ where: { id: String(payload.sub) }, select: { id: true, email: true } });
      if (!admin) throw new Error('gone');
      req.admin = admin;
      return true;
    } catch {
      throw new AppError('ADMIN_LOGIN', 'Сессия закончилась, войдите снова', 401);
    }
  }
}

export const passwordHashOk = (s: string) => s.length >= 12;
export const ipOf = (req: Request) => (req.ip ?? '').replace(/^::ffff:/, '');
export const sha = (s: string) => createHash('sha256').update(s).digest('hex');
