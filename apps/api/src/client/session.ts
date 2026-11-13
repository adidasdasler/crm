/**
 * Сессия клиента на mioflow.ru: httpOnly-cookie на 30 дней, подпись отдельным ключом.
 * При смене пароля, сбросе или «выйти везде» sessionVersion растёт — старые cookie перестают действовать.
 */
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { AppError } from '../common/errors';
import { cookieSecure } from '../config';
import { env } from '../config';
import type { PrismaService } from '../common/prisma.service';

export const CLIENT_COOKIE = 'mioflow_client';
const DAYS = 30;
const key = (purpose: string) => createHash('sha256').update(`${env.JWT_SECRET}:mioflow-client:${purpose}`).digest();

export async function setClientSession(res: Response, u: { id: string; sessionVersion: number }) {
  const token = await new SignJWT({ v: u.sessionVersion }).setProtectedHeader({ alg: 'HS256' }).setSubject(u.id).setAudience('mioflow-client')
    .setIssuedAt().setExpirationTime(`${DAYS}d`).sign(key('session'));
  // path=/v1 — cookie нужна и кабинету (/v1/client), и онлайн-записи (/v1/public), чтобы связать запись с аккаунтом
  res.cookie(CLIENT_COOKIE, token, { httpOnly: true, secure: cookieSecure, sameSite: 'lax', path: '/v1', maxAge: DAYS * 86400_000 });
}
export const clearClientSession = (res: Response) => res.clearCookie(CLIENT_COOKIE, { path: '/v1' });

/** Текущий клиент или null (без ошибки) — для онлайн-записи */
export async function readClient(req: Request, prisma: PrismaService) {
  const token = req.cookies?.[CLIENT_COOKIE] as string | undefined;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key('session'), { audience: 'mioflow-client' });
    const u = await prisma.system.clientUser.findUnique({ where: { id: String(payload.sub) } });
    return u && u.sessionVersion === payload.v ? u : null;
  } catch {
    return null;
  }
}

export async function requireClient(req: Request, prisma: PrismaService) {
  const u = await readClient(req, prisma);
  if (!u) throw new AppError('CLIENT_LOGIN', 'Войдите в кабинет', 401);
  return u;
}

/** Состояние входа через Яндекс/VK: state и PKCE-verifier в подписанной cookie на 10 минут */
export async function signOAuthState(s: { provider: string; state: string; verifier: string; consent: boolean }) {
  return new SignJWT(s).setProtectedHeader({ alg: 'HS256' }).setAudience('mioflow-oauth').setExpirationTime('10m').sign(key('oauth'));
}
export async function readOAuthState(token: string | undefined) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key('oauth'), { audience: 'mioflow-oauth' });
    return payload as unknown as { provider: string; state: string; verifier: string; consent: boolean };
  } catch {
    return null;
  }
}

/** Изменяющие запросы кабинета — только из нашего интерфейса (защита от подделки запросов) */
export function assertXhr(req: Request) {
  if (!req.headers['x-requested-with']) throw new AppError('CSRF', 'Отсутствует заголовок X-Requested-With', 403);
}
