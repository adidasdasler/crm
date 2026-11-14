import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public } from '../common/auth';
import { randomToken, sha256 } from '../common/crypto';
import { AppError, conflict } from '../common/errors';
import { Zod } from '../common/http';
import { CLIENT_CONSENT_VERSION } from '../common/legal';
import { manageToken } from '../common/manage-token';
import { normalizePhone } from '../common/phone';
import { PrismaService } from '../common/prisma.service';
import { env } from '../config';
import { mailer } from '../notify/mailer';
import { authorizeUrl, enabledProviders, oauth, pkce, Provider } from './oauth';
import { assertXhr, clearClientSession, readOAuthState, requireClient, setClientSession, signOAuthState } from './session';

const email = z.string().trim().toLowerCase().email('Некорректный email').max(200);
const password = z.string().min(8, 'Пароль — минимум 8 символов').max(128);
const OAUTH_COOKIE = 'mioflow_oauth';
const MAX_FAILED = 5;

/**
 * Кабинет клиента на mioflow.ru: свои записи во всех салонах MioFlow на любом устройстве.
 * Записи находятся по аккаунту (записался из кабинета или привязал ссылку), по подтверждённому email
 * и по телефону, подтверждённому Яндекс ID.
 */
@Public()
@Controller('client')
export class ClientController {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.system;
  }

  private view(u: { id: string; name: string; email: string | null; emailVerifiedAt: Date | null; phone: string | null; phoneVerifiedAt: Date | null; passwordHash: string | null; yandexId: string | null }) {
    return {
      id: u.id, name: u.name, email: u.email, emailVerified: !!u.emailVerifiedAt, phone: u.phone, phoneVerified: !!u.phoneVerifiedAt,
      hasPassword: !!u.passwordHash, yandex: !!u.yandexId,
    };
  }

  private async sendVerify(u: { id: string; email: string | null; name: string }) {
    if (!u.email) return false;
    const token = randomToken(32);
    await this.db.clientUser.update({ where: { id: u.id }, data: { verifyHash: sha256(token) } });
    return mailer.send({
      to: u.email, subject: 'Подтвердите email — MioFlow',
      text: `Здравствуйте, ${u.name}!\n\nПодтвердите email, чтобы в кабинете появились все ваши записи:\n${env.PUBLIC_WEB_URL}/account/verify?token=${token}\n\nЕсли вы не регистрировались на mioflow.ru — просто проигнорируйте письмо.`,
    });
  }

  /** Настройки страницы входа: какие кнопки показывать */
  @Get('config')
  config() {
    return { providers: enabledProviders() };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(@Body(new Zod(z.object({ name: z.string().trim().min(1).max(100), email, password, consent: z.literal(true, { error: 'Нужно согласие на обработку персональных данных' }) }))) dto: { name: string; email: string; password: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertXhr(req);
    if (await this.db.clientUser.findUnique({ where: { email: dto.email } })) throw conflict('EMAIL_TAKEN', 'Этот email уже зарегистрирован. Войдите или восстановите пароль');
    const u = await this.db.clientUser.create({
      data: { name: dto.name, email: dto.email, passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }), consentVersion: CLIENT_CONSENT_VERSION, lastLoginAt: new Date() },
    });
    await this.sendVerify(u);
    await setClientSession(res, u);
    return this.view(u);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(@Body(new Zod(z.object({ email, password: z.string().min(1).max(128) }))) dto: { email: string; password: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertXhr(req);
    const invalid = new AppError('INVALID_CREDENTIALS', 'Неверный email или пароль', 401);
    const u = await this.db.clientUser.findUnique({ where: { email: dto.email } });
    if (!u?.passwordHash) {
      await argon2.hash(dto.password).catch(() => null);
      // Аккаунт создан через Яндекс или VK — подскажем, как войти
      if (u && !u.passwordHash) throw new AppError('USE_OAUTH', 'Вы входили через Яндекс ID — войдите той же кнопкой или задайте пароль через «Забыли пароль?»', 401);
      throw invalid;
    }
    if (u.lockedUntil && u.lockedUntil > new Date()) throw new AppError('ACCOUNT_LOCKED', 'Слишком много попыток. Попробуйте через 15 минут или восстановите пароль', 423);
    if (!(await argon2.verify(u.passwordHash, dto.password))) {
      const n = u.failedAttempts + 1;
      await this.db.clientUser.update({ where: { id: u.id }, data: { failedAttempts: n >= MAX_FAILED ? 0 : n, lockedUntil: n >= MAX_FAILED ? new Date(Date.now() + 15 * 60_000) : null } });
      throw invalid;
    }
    const fresh = await this.db.clientUser.update({ where: { id: u.id }, data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await setClientSession(res, fresh);
    return this.view(fresh);
  }

  @HttpCode(200)
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    clearClientSession(res);
    return { ok: true };
  }

  @Get('me')
  async me(@Req() req: Request) {
    return this.view(await requireClient(req, this.prisma));
  }

  @HttpCode(200)
  @Post('verify')
  async verify(@Body(new Zod(z.object({ token: z.string().min(20).max(100) }))) dto: { token: string }) {
    const u = await this.db.clientUser.findUnique({ where: { verifyHash: sha256(dto.token) } });
    if (!u) throw new AppError('VERIFY_INVALID', 'Ссылка устарела или уже использована', 400);
    await this.db.clientUser.update({ where: { id: u.id }, data: { emailVerifiedAt: new Date(), verifyHash: null } });
    return { ok: true };
  }

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(200)
  @Post('verify/resend')
  async resend(@Req() req: Request) {
    assertXhr(req);
    const u = await requireClient(req, this.prisma);
    if (u.emailVerifiedAt) return { ok: true };
    if (!(await this.sendVerify(u))) throw new AppError('MAIL_NOT_SENT', 'Не удалось отправить письмо. Попробуйте позже', 503);
    return { ok: true };
  }

  /** Всегда отвечает одинаково — нельзя проверить, зарегистрирован ли email */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(200)
  @Post('forgot')
  async forgot(@Body(new Zod(z.object({ email }))) dto: { email: string }, @Req() req: Request) {
    assertXhr(req);
    const u = await this.db.clientUser.findUnique({ where: { email: dto.email } });
    if (u) {
      const token = randomToken(32);
      await this.db.clientUser.update({ where: { id: u.id }, data: { resetHash: sha256(token), resetExpires: new Date(Date.now() + 60 * 60_000) } });
      await mailer.send({
        to: dto.email, subject: 'Восстановление пароля — MioFlow',
        text: `Здравствуйте, ${u.name}!\n\nЧтобы задать ${u.passwordHash ? 'новый' : ''} пароль для кабинета MioFlow, перейдите по ссылке (действует 60 минут):\n${env.PUBLIC_WEB_URL}/account/reset?token=${token}\n\nЕсли вы не запрашивали восстановление — просто проигнорируйте письмо.`,
      });
    }
    return { ok: true };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('reset')
  async reset(@Body(new Zod(z.object({ token: z.string().min(20).max(100), password }))) dto: { token: string; password: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertXhr(req);
    const u = await this.db.clientUser.findUnique({ where: { resetHash: sha256(dto.token) } });
    if (!u || !u.resetExpires || u.resetExpires < new Date()) throw new AppError('RESET_INVALID', 'Ссылка устарела или уже использована. Запросите новую', 400);
    const fresh = await this.db.clientUser.update({
      where: { id: u.id },
      data: {
        passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }), resetHash: null, resetExpires: null,
        failedAttempts: 0, lockedUntil: null, sessionVersion: { increment: 1 },
        // Ссылка пришла на этот email — значит, он подтверждён
        emailVerifiedAt: u.emailVerifiedAt ?? new Date(), lastLoginAt: new Date(),
      },
    });
    await setClientSession(res, fresh);
    return this.view(fresh);
  }

  /** Все записи клиента во всех салонах MioFlow */
  @Get('bookings')
  async bookings(@Req() req: Request) {
    const u = await requireClient(req, this.prisma);
    const or = [
      { clientUserId: u.id },
      ...(u.email && u.emailVerifiedAt ? [{ email: u.email }] : []),
      ...(u.phone && u.phoneVerifiedAt ? [{ phone: u.phone }] : []),
    ];
    const customers = await this.db.customer.findMany({ where: { deletedAt: null, OR: or }, select: { id: true } });
    const own = await this.db.clientBooking.findMany({ where: { clientUserId: u.id }, select: { bookingId: true } });
    const rows = await this.db.booking.findMany({
      where: { OR: [{ customerId: { in: customers.map((c) => c.id) } }, { id: { in: own.map((x) => x.bookingId) } }] },
      orderBy: { startsAt: 'desc' }, take: 200,
      include: { items: { orderBy: { sortOrder: 'asc' }, select: { name: true, serviceId: true } }, resource: { select: { name: true } } },
    });
    const tenants = new Map((await this.db.tenant.findMany({
      where: { id: { in: [...new Set(rows.map((b) => b.tenantId))] }, deletedAt: null, blockedAt: null },
      select: { id: true, slug: true, name: true, address: true, phone: true, timezone: true },
    })).map((t) => [t.id, t]));
    return rows.filter((b) => tenants.has(b.tenantId)).map((b) => {
      const t = tenants.get(b.tenantId)!;
      return {
        slug: t.slug, token: manageToken(b.id), startsAt: b.startsAt, status: b.status, price: b.price,
        services: b.items.map((i) => i.name), serviceIds: b.items.map((i) => i.serviceId), resource: b.resource.name, resourceId: b.resourceId,
        salon: { name: t.name, address: t.address, phone: t.phone, timezone: t.timezone },
      };
    });
  }

  /** Привязать записи, сохранённые на этом устройстве (владение ссылкой «управлять записью» = доказательство) */
  @HttpCode(200)
  @Post('claim')
  async claim(@Body(new Zod(z.object({ refs: z.array(z.object({ slug: z.string().max(60), token: z.string().min(10).max(60) })).max(100) }))) dto: { refs: { slug: string; token: string }[] }, @Req() req: Request) {
    assertXhr(req);
    const u = await requireClient(req, this.prisma);
    // Привязываем только сами записи: ссылка открывает одну запись, а не всю историю клиента в салоне
    const found = await this.db.booking.findMany({ where: { manageTokenHash: { in: dto.refs.map((r) => sha256(r.token)) } }, select: { id: true } });
    const r = await this.db.clientBooking.createMany({ data: found.map((b) => ({ clientUserId: u.id, bookingId: b.id })), skipDuplicates: true });
    return { linked: r.count };
  }

  @HttpCode(200)
  @Post('profile')
  async profile(@Body(new Zod(z.object({ name: z.string().trim().min(1).max(100).optional(), phone: z.string().max(30).optional() }))) dto: { name?: string; phone?: string }, @Req() req: Request) {
    assertXhr(req);
    const u = await requireClient(req, this.prisma);
    const phone = dto.phone !== undefined ? (dto.phone.trim() ? normalizePhone(dto.phone) : null) : undefined;
    if (dto.phone?.trim() && !phone) throw new AppError('VALIDATION_ERROR', 'Некорректный телефон');
    const fresh = await this.db.clientUser.update({
      where: { id: u.id },
      // Телефон, введённый вручную, не подтверждён: по нему записи не подтягиваются (иначе можно смотреть чужие)
      data: { ...(dto.name ? { name: dto.name } : {}), ...(phone !== undefined && phone !== u.phone ? { phone, phoneVerifiedAt: null } : {}) },
    });
    return this.view(fresh);
  }

  /** Удаление аккаунта (152-ФЗ): записи в салонах остаются у салонов, связь с аккаунтом убирается */
  @HttpCode(200)
  @Delete('me')
  async remove(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertXhr(req);
    const u = await requireClient(req, this.prisma);
    await this.db.$transaction([
      this.db.customer.updateMany({ where: { clientUserId: u.id }, data: { clientUserId: null } }),
      this.db.clientBooking.deleteMany({ where: { clientUserId: u.id } }),
      this.db.clientUser.delete({ where: { id: u.id } }),
    ]);
    clearClientSession(res);
    return { ok: true };
  }

  // ─── Вход через Яндекс ID ───

  @Get('oauth/:provider/start')
  async start(@Param('provider') p: string, @Query('consent') consent: string | undefined, @Res() res: Response) {
    const provider = p as Provider;
    if (!enabledProviders().includes(provider)) throw new AppError('OAUTH_DISABLED', 'Этот способ входа не подключён', 404);
    const { verifier, challenge, state } = pkce();
    res.cookie(OAUTH_COOKIE, await signOAuthState({ provider, state, verifier, consent: consent === '1' }), {
      httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/v1/client/oauth', maxAge: 10 * 60_000,
    });
    return res.redirect(authorizeUrl(provider, state, challenge));
  }

  @Get('oauth/:provider/callback')
  async callback(@Param('provider') p: string, @Query() q: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    const back = (err?: string) => res.redirect(`${env.PUBLIC_WEB_URL}/${err ? `account/login?error=${encodeURIComponent(err)}` : 'my'}`);
    const st = await readOAuthState(req.cookies?.[OAUTH_COOKIE]);
    res.clearCookie(OAUTH_COOKIE, { path: '/v1/client/oauth' });
    if (!st || st.provider !== p || !q.code || q.state !== st.state) return back('Вход не завершён — попробуйте ещё раз');
    let prof;
    try {
      prof = await oauth.profile(p as Provider, { code: q.code, verifier: st.verifier });
    } catch {
      return back('Не удалось войти через Яндекс ID. Попробуйте ещё раз');
    }
    let u = await this.db.clientUser.findUnique({ where: { yandexId: prof.id } });
    // Тот же человек уже регистрировался по email — привязываем (email подтверждён Яндексом)
    if (!u && prof.email) u = await this.db.clientUser.findUnique({ where: { email: prof.email } });
    const verified = { ...(prof.email ? { emailVerifiedAt: new Date() } : {}), ...(prof.phone ? { phone: prof.phone, phoneVerifiedAt: new Date() } : {}) };
    if (u) {
      // Аккаунт с этим email мог завести кто-то другой, не подтвердив почту: тогда снимаем его пароль и сессии,
      // чтобы владелец настоящего Яндекс-аккаунта не делил кабинет с посторонним
      const takeover = !!prof.email && u.email === prof.email && !u.emailVerifiedAt && !u.yandexId;
      u = await this.db.clientUser.update({
        where: { id: u.id },
        data: {
          yandexId: prof.id, lastLoginAt: new Date(),
          ...(prof.email && u.email === prof.email ? verified : prof.phone ? { phone: prof.phone, phoneVerifiedAt: new Date() } : {}),
          ...(takeover ? { passwordHash: null, sessionVersion: { increment: 1 } } : {}),
        },
      });
    } else {
      // Новый аккаунт — только с согласием, отмеченным на странице входа
      if (!st.consent) return back('Отметьте согласие на обработку персональных данных и нажмите кнопку ещё раз');
      u = await this.db.clientUser.create({
        data: { name: prof.name, email: prof.email, yandexId: prof.id, consentVersion: CLIENT_CONSENT_VERSION, lastLoginAt: new Date(), ...verified },
      });
    }
    await setClientSession(res, u);
    return back();
  }
}
