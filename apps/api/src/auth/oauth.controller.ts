import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authorizeUrl, enabledProviders, oauth, pkce, Provider } from '../client/oauth';
import { readOAuthState, signOAuthState } from '../client/session';
import { Public } from '../common/auth';
import { randomToken, sha256 } from '../common/crypto';
import { AppError } from '../common/errors';
import { Zod } from '../common/http';
import { PrismaService } from '../common/prisma.service';
import { env } from '../config';
import { DEMO_EMAIL } from '../demo/demo';
import { sendTokens } from './auth.controller';
import { AuthService } from './auth.service';

const STATE_COOKIE = 'mioflow_staff_oauth';
const TICKET_MIN = 15;

/**
 * Вход владельцев, администраторов и мастеров через Яндекс ID и VK ID.
 * Веб (app.mioflow.ru): после входа — сразу cookie-сессия. Мобильное приложение: возврат по ссылке
 * mioflow://oauth?ticket=… и обмен одноразового билета на токены.
 * Нового человека отправляем на регистрацию салона с подставленными именем и email.
 */
@Public()
@Controller('auth/oauth')
export class StaffOAuthController {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService) {}

  @Get('config')
  config() {
    return { providers: enabledProviders() };
  }

  @Get(':provider/start')
  async start(@Param('provider') p: string, @Query('mobile') mobile: string | undefined, @Res() res: Response) {
    const provider = p as Provider;
    if (!enabledProviders().includes(provider)) throw new AppError('OAUTH_DISABLED', 'Этот способ входа не подключён', 404);
    const { verifier, challenge, state } = pkce();
    res.cookie(STATE_COOKIE, await signOAuthState({ provider, state, verifier, consent: false, mobile: mobile === '1' }), {
      httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/v1/auth/oauth', maxAge: 10 * 60_000,
    });
    return res.redirect(authorizeUrl(provider, state, challenge, 'staff'));
  }

  private async ticket(kind: 'login' | 'register', payload: object) {
    const t = randomToken(32);
    await this.prisma.system.oAuthTicket.create({ data: { hash: sha256(t), kind, payload, expiresAt: new Date(Date.now() + TICKET_MIN * 60_000) } });
    // Заодно чистим просроченные
    await this.prisma.system.oAuthTicket.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    return t;
  }

  @Get(':provider/callback')
  async callback(@Param('provider') p: string, @Query() q: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    const st = await readOAuthState(req.cookies?.[STATE_COOKIE]);
    res.clearCookie(STATE_COOKIE, { path: '/v1/auth/oauth' });
    const base = st?.mobile ? 'mioflow://' : `${env.APP_URL}/`;
    const go = (path: string, params: Record<string, string>) => res.redirect(`${base}${path}?${new URLSearchParams(params)}`);
    if (!st || st.provider !== p || !q.code || q.state !== st.state) return go('login', { error: 'Вход не завершён — попробуйте ещё раз' });

    let prof;
    try {
      prof = await oauth.profile(p as Provider, { code: q.code, verifier: st.verifier, state: q.state, deviceId: q.device_id, who: 'staff' });
    } catch {
      return go('login', { error: `Не удалось войти через ${p === 'yandex' ? 'Яндекс ID' : 'VK ID'}. Попробуйте ещё раз` });
    }
    const db = this.prisma.system;
    const idField = p === 'yandex' ? 'yandexId' : 'vkId';
    let user = await db.user.findFirst({ where: { [idField]: prof.id, deletedAt: null } });
    // Уже зарегистрирован по email — привязываем Яндекс/VK (email подтверждён провайдером)
    if (!user && prof.email) {
      const byEmail = await db.user.findFirst({ where: { email: prof.email, deletedAt: null } });
      if (byEmail && byEmail.email !== DEMO_EMAIL) user = await db.user.update({ where: { id: byEmail.id }, data: { [idField]: prof.id } });
    }

    if (!user) {
      // Новый человек — регистрация салона или частного мастера, имя и email уже известны
      const t = await this.ticket('register', { provider: p, id: prof.id, email: prof.email, name: prof.name, phone: prof.phone });
      return go('register', { oauth: t, name: prof.name, ...(prof.email ? { email: prof.email } : {}), ...(prof.phone ? { phone: prof.phone } : {}) });
    }

    try {
      const r = await this.auth.completeLogin(user, { ip: req.ip, userAgent: req.headers['user-agent'] });
      // Включён вход с кодом — код всё равно нужен
      if ('twoFactor' in r && r.twoFactor) return go('login', { tf: r.twoFactor.challenge, sent: r.twoFactor.sentTo });
      if (st.mobile) return go('oauth', { ticket: await this.ticket('login', { userId: user.id }) });
      sendTokens(req, res, r.tokens);
      return res.redirect(`${env.APP_URL}/`);
    } catch (e) {
      return go('login', { error: e instanceof AppError ? String((e.getResponse() as { message?: string }).message ?? e.message) : 'Не удалось войти' });
    }
  }

  /** Мобильное приложение: одноразовый билет → токены */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('exchange')
  async exchange(@Body(new Zod(z.object({ ticket: z.string().min(20).max(100) }))) dto: { ticket: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const db = this.prisma.system;
    const tk = await db.oAuthTicket.findUnique({ where: { hash: sha256(dto.ticket) } });
    if (!tk || tk.kind !== 'login' || tk.expiresAt < new Date()) throw new AppError('OAUTH_TICKET', 'Вход устарел — нажмите кнопку ещё раз', 400);
    await db.oAuthTicket.delete({ where: { hash: tk.hash } });
    const user = await db.user.findUniqueOrThrow({ where: { id: (tk.payload as { userId: string }).userId } });
    const r = await this.auth.completeLogin(user, { ip: req.ip, userAgent: req.headers['user-agent'] });
    if ('twoFactor' in r) return { twoFactor: r.twoFactor };
    return { ...sendTokens(req, res, r.tokens), user: r.user, tenants: r.tenants };
  }
}
