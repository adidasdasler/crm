import { INDUSTRY_CODES } from '../common/industries';
import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { cookieSecure, env } from '../config';
import { Auth, AuthCtx, Public, NoDemo } from '../common/auth';
import { AppError } from '../common/errors';
import { Zod } from '../common/http';
import { uuid } from '../common/schemas';
import { AuthService, Tokens } from './auth.service';

const email = z.string().trim().toLowerCase().email('Некорректный email');
const password = z.string().min(8, 'Пароль — минимум 8 символов').max(128);
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/, 'Адрес: 3–32 символа, латиница, цифры и дефис');

const registerSchema = z.object({
  email,
  password,
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(20).optional(),
  /** solo — частный мастер (название и адрес страницы не обязательны), salon — салон или студия */
  kind: z.enum(['solo', 'salon']).default('salon'),
  salonName: z.string().trim().min(2).max(100).optional(),
  /** Для частного мастера можно не указывать — сформируем из имени */
  slug: slug.optional(),
  timezone: z.string().default('Europe/Moscow').refine((tz) => {
    try { new Intl.DateTimeFormat('ru', { timeZone: tz }); return true; } catch { return false; }
  }, 'Неизвестный часовой пояс'),
  /** Сфера бизнеса: меняет слова в интерфейсе и стартовые услуги */
  industry: z.enum(INDUSTRY_CODES).optional(),
  /** Принятие оферты */
  acceptTerms: z.literal(true, { error: 'Необходимо принять условия оферты' }),
  /** Отдельное согласие на обработку ПДн (152-ФЗ, ст. 9) */
  acceptPrivacy: z.literal(true, { error: 'Необходимо согласие на обработку персональных данных' }),
  /** honeypot: настоящий пользователь это поле не заполняет */
  website: z.string().max(0).optional(),
}).refine((d) => d.kind === 'solo' || (!!d.salonName && !!d.slug), { error: 'Укажите название салона и адрес страницы', path: ['salonName'] });
const loginSchema = z.object({ email, password: z.string().min(1).max(128), tenantId: uuid.optional() });
const refreshSchema = z.object({ refreshToken: z.string().min(10).optional() });

export const REFRESH_COOKIE_PATH = '/v1/auth';

/**
 * Веб-клиент получает токены в httpOnly-cookie.
 * Мобильный клиент (заголовок X-Client: mobile) — в теле ответа, хранит в SecureStore.
 */
function sendTokens(req: Request, res: Response, tokens: Tokens) {
  if (req.headers['x-client'] === 'mobile') {
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  }
  const base = { httpOnly: true, secure: cookieSecure, sameSite: 'lax' as const, domain: env.COOKIE_DOMAIN };
  res.cookie('access_token', tokens.accessToken, { ...base, path: '/', maxAge: env.JWT_ACCESS_TTL_MIN * 60_000 });
  res.cookie('refresh_token', tokens.refreshToken, { ...base, path: REFRESH_COOKIE_PATH, expires: tokens.refreshExpiresAt });
  return {};
}

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get('check-slug')
  async checkSlug(@Query('slug') value: string) {
    const r = slug.safeParse(value ?? '');
    return { available: r.success && (await this.auth.isSlugAvailable(r.data)) };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(@Body(new Zod(registerSchema)) dto: z.infer<typeof registerSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.register(dto, meta(req));
    return { ...sendTokens(req, res, r.tokens), user: r.user, tenant: r.tenant };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(@Body(new Zod(loginSchema)) dto: z.infer<typeof loginSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(dto, meta(req));
    return { ...sendTokens(req, res, r.tokens), user: r.user, tenants: r.tenants };
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Body(new Zod(refreshSchema)) dto: z.infer<typeof refreshSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = dto.refreshToken ?? req.cookies?.refresh_token;
    if (!token) throw new AppError('INVALID_REFRESH', 'Нет refresh-токена', 401);
    return sendTokens(req, res, await this.auth.refresh(token, meta(req)));
  }

  @Public()
  @HttpCode(200)
  @Post('logout')
  async logout(@Body(new Zod(refreshSchema)) dto: z.infer<typeof refreshSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(dto.refreshToken ?? req.cookies?.refresh_token);
    res.clearCookie('access_token', { path: '/', domain: env.COOKIE_DOMAIN });
    res.clearCookie('refresh_token', { path: REFRESH_COOKIE_PATH, domain: env.COOKIE_DOMAIN });
    return { ok: true };
  }

  @Get('me')
  me(@Auth() auth: AuthCtx) {
    return this.auth.me(auth);
  }

  @HttpCode(200)
  @Post('switch-tenant')
  async switchTenant(@Auth() auth: AuthCtx, @Body(new Zod(z.object({ tenantId: uuid }))) dto: { tenantId: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return sendTokens(req, res, await this.auth.switchTenant(auth, dto.tenantId, meta(req)));
  }

  @HttpCode(200)
  @NoDemo()
  @Post('change-password')
  async changePassword(@Auth() auth: AuthCtx, @Body(new Zod(z.object({ currentPassword: z.string(), newPassword: password }))) dto: { currentPassword: string; newPassword: string }) {
    await this.auth.changePassword(auth, dto.currentPassword, dto.newPassword);
    return { ok: true };
  }

  @HttpCode(200)
  @NoDemo()
  @Post('revoke-sessions')
  async revokeSessions(@Auth() auth: AuthCtx) {
    await this.auth.revokeAllSessions(auth.userId);
    return { ok: true };
  }
}
