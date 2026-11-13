/**
 * Действия поддержки в панели владельца: карточка салона, блокировка, удаление с восстановлением
 * в течение 30 дней, смена названия/адреса/тарифа, помощь владельцу с доступом.
 * Каждое изменяющее действие — только с повторным вводом пароля и кода из приложения-аутентификатора,
 * с записью в журнал. Данные клиентов салонов здесь не меняются и не показываются.
 */
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import * as argon2 from 'argon2';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { invalidateTenantAccess, Public } from '../common/auth';
import { randomToken, sha256 } from '../common/crypto';
import { AppError, conflict, notFound } from '../common/errors';
import { Zod } from '../common/http';
import { PrismaService } from '../common/prisma.service';
import { open } from '../common/secret-box';
import { env } from '../config';
import { DEMO_SLUG } from '../demo/demo';
import { mailer } from '../notify/mailer';
import { AdminCtx, AdminGuard } from './admin-auth';
import { verifyTotp } from './totp';

type Admin = Request & { admin: AdminCtx };
const DAY = 86400_000;
const RESTORE_DAYS = 30;
const RESERVED = new Set(['app', 'api', 'www', 'admin', 'mail', 'static', 'cdn', 'help', 'support', 'blog', 'b', 'demo', 'my']);

const confirmSchema = { password: z.string().min(1).max(200), code: z.string().max(12) };
const withConfirm = <T extends z.ZodRawShape>(shape: T) => z.object({ ...shape, ...confirmSchema });

@Public()
@UseGuards(AdminGuard)
@Throttle({ default: { limit: 20, ttl: 60_000 } })
@Controller('admin/tenants')
export class AdminSupportController {
  constructor(private readonly prisma: PrismaService) {}

  /** Повторное подтверждение: пароль + код. Ошибки считаются вместе со входом (5 → блокировка на 30 минут) */
  private async confirm(admin: AdminCtx, password: string, code: string) {
    const db = this.prisma.system;
    const a = await db.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
    if (a.lockedUntil && a.lockedUntil > new Date()) throw new AppError('ACCOUNT_LOCKED', 'Слишком много ошибок. Подождите 30 минут', 423);
    if ((await argon2.verify(a.passwordHash, password)) && verifyTotp(open(a.totpSecretEnc), code)) {
      if (a.failedAttempts) await db.adminUser.update({ where: { id: a.id }, data: { failedAttempts: 0 } });
      return;
    }
    const n = a.failedAttempts + 1;
    await db.adminUser.update({ where: { id: a.id }, data: { failedAttempts: n >= 5 ? 0 : n, lockedUntil: n >= 5 ? new Date(Date.now() + 30 * 60_000) : null } });
    throw new AppError('CONFIRM_INVALID', 'Неверный пароль или код — действие не выполнено', 403);
  }

  private async tenant(id: string) {
    const t = await this.prisma.system.tenant.findUnique({ where: { id } });
    if (!t) throw notFound('Салон');
    if (t.slug === DEMO_SLUG) throw new AppError('DEMO', 'Демо-салон меняется только сбросом', 422);
    return t;
  }

  private async owner(tenantId: string) {
    return (await this.prisma.system.membership.findFirst({
      where: { tenantId, role: 'OWNER' }, orderBy: { createdAt: 'asc' },
      select: { user: { select: { id: true, email: true, name: true, lastLoginAt: true, twoFactorEnabled: true, deletedAt: true } } },
    }))?.user ?? null;
  }

  private log(req: Admin, tenantId: string, action: string, after: Record<string, unknown> = {}) {
    return this.prisma.system.auditLog.create({ data: { tenantId, action: `admin.${action}`, entityType: 'Tenant', entityId: tenantId, ip: req.ip, after: { ...after, by: req.admin.email } } });
  }

  private notify(email: string | undefined, subject: string, text: string) {
    if (email) void mailer.send({ to: email, subject, text: `${text}\n\nВопросы — ${env.SUPPORT_EMAIL}\nКоманда MioFlow` }).catch(() => null);
  }

  /** Карточка салона: без данных клиентов — только количества */
  @Get(':id')
  async card(@Param('id', ParseUUIDPipe) id: string) {
    const db = this.prisma.system;
    const t = await db.tenant.findUnique({ where: { id } });
    if (!t) throw notFound('Салон');
    const [owner, sub, masters, staff, customers, bookings30, plans, history] = await Promise.all([
      this.owner(id),
      db.subscription.findUnique({ where: { tenantId: id }, include: { plan: { select: { code: true, name: true } } } }),
      db.resource.count({ where: { tenantId: id, deletedAt: null, isActive: true } }),
      db.membership.count({ where: { tenantId: id, deletedAt: null } }),
      db.customer.count({ where: { tenantId: id, deletedAt: null } }),
      db.booking.count({ where: { tenantId: id, createdAt: { gte: new Date(Date.now() - 30 * DAY) } } }),
      db.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { code: true, name: true } }),
      db.auditLog.findMany({ where: { tenantId: id, action: { startsWith: 'admin.' } }, orderBy: { createdAt: 'desc' }, take: 30, select: { action: true, createdAt: true, after: true } }),
    ]);
    const restoreUntil = t.deletedAt ? new Date(+t.deletedAt + RESTORE_DAYS * DAY) : null;
    return {
      id: t.id, name: t.name, slug: t.deletedSlug ?? t.slug, createdAt: t.createdAt,
      blockedAt: t.blockedAt, blockReason: t.blockReason,
      deletedAt: t.deletedAt, canRestore: !!t.deletedAt && t.slug.startsWith('removed-') && restoreUntil! > new Date(), restoreUntil,
      owner: owner && { email: owner.email, name: owner.name, lastLoginAt: owner.lastLoginAt, twoFactor: owner.twoFactorEnabled, deleted: !!owner.deletedAt },
      subscription: sub && { status: sub.status, plan: sub.plan, trialEndsAt: sub.trialEndsAt, currentPeriodEnd: sub.currentPeriodEnd },
      counts: { masters, staff, customers, bookings30 },
      plans, history,
    };
  }

  @HttpCode(200)
  @Post(':id/block')
  async block(@Req() req: Admin, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(withConfirm({ reason: z.string().trim().min(3).max(300) }))) dto: { reason: string; password: string; code: string }) {
    await this.confirm(req.admin, dto.password, dto.code);
    const t = await this.tenant(id);
    await this.prisma.system.tenant.update({ where: { id }, data: { blockedAt: new Date(), blockReason: dto.reason } });
    invalidateTenantAccess(id);
    await this.log(req, id, 'block', { reason: dto.reason });
    this.notify((await this.owner(id))?.email, `Салон «${t.name}» заблокирован`, `Доступ к салону «${t.name}» в MioFlow и онлайн-запись приостановлены.\nПричина: ${dto.reason}`);
    return { ok: true };
  }

  @HttpCode(200)
  @Post(':id/unblock')
  async unblock(@Req() req: Admin, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(z.object(confirmSchema))) dto: { password: string; code: string }) {
    await this.confirm(req.admin, dto.password, dto.code);
    const t = await this.tenant(id);
    await this.prisma.system.tenant.update({ where: { id }, data: { blockedAt: null, blockReason: null } });
    invalidateTenantAccess(id);
    await this.log(req, id, 'unblock');
    this.notify((await this.owner(id))?.email, `Салон «${t.name}» снова работает`, `Доступ к салону «${t.name}» в MioFlow и онлайн-запись восстановлены.`);
    return { ok: true };
  }

  /** Удаление: сразу закрывается, данные стираются через 30 дней; до этого можно восстановить */
  @HttpCode(200)
  @Post(':id/delete')
  async remove(@Req() req: Admin, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(withConfirm({ confirmName: z.string(), reason: z.string().trim().min(3).max(300) }))) dto: { confirmName: string; reason: string; password: string; code: string }) {
    await this.confirm(req.admin, dto.password, dto.code);
    const t = await this.tenant(id);
    if (t.deletedAt) throw new AppError('ALREADY_DELETED', 'Салон уже удалён', 409);
    if (dto.confirmName.trim() !== t.name.trim()) throw new AppError('CONFIRM_NAME', 'Название салона введено неверно — удаление отменено', 422);
    const now = new Date();
    const owner = await this.owner(id);
    await this.prisma.system.$transaction([
      this.prisma.system.tenant.update({ where: { id }, data: { deletedAt: now, deletedSlug: t.slug, slug: `removed-${id}` } }),
      // Отметка временем удаления: при восстановлении вернём именно эти доступы
      this.prisma.system.membership.updateMany({ where: { tenantId: id, deletedAt: null }, data: { deletedAt: now } }),
    ]);
    invalidateTenantAccess(id);
    await this.log(req, id, 'delete', { reason: dto.reason, slug: t.slug });
    this.notify(owner?.email, `Салон «${t.name}» удалён`, `Салон «${t.name}» удалён из MioFlow.\nПричина: ${dto.reason}\nЕсли это ошибка, напишите нам в течение ${RESTORE_DAYS} дней — после этого данные будут стёрты окончательно.`);
    return { ok: true, restoreUntil: new Date(+now + RESTORE_DAYS * DAY) };
  }

  @HttpCode(200)
  @Post(':id/restore')
  async restore(@Req() req: Admin, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(z.object(confirmSchema))) dto: { password: string; code: string }) {
    await this.confirm(req.admin, dto.password, dto.code);
    const db = this.prisma.system;
    const t = await this.tenant(id);
    if (!t.deletedAt || !t.slug.startsWith('removed-')) throw new AppError('NOT_RESTORABLE', 'Салон не удалён или данные уже стёрты', 422);
    if (+t.deletedAt + RESTORE_DAYS * DAY < Date.now()) throw new AppError('NOT_RESTORABLE', `Прошло больше ${RESTORE_DAYS} дней — восстановить нельзя`, 422);
    // Адрес страницы мог занять другой салон — тогда подбираем свободный
    let slug = t.deletedSlug ?? `salon-${id.slice(0, 6)}`;
    for (let i = 2; await db.tenant.findUnique({ where: { slug } }); i++) slug = `${t.deletedSlug}-${i}`;
    await db.$transaction([
      db.tenant.update({ where: { id }, data: { deletedAt: null, deletedSlug: null, slug } }),
      db.membership.updateMany({ where: { tenantId: id, deletedAt: t.deletedAt }, data: { deletedAt: null } }),
    ]);
    invalidateTenantAccess(id);
    await this.log(req, id, 'restore', { slug });
    this.notify((await this.owner(id))?.email, `Салон «${t.name}» восстановлен`, `Салон «${t.name}» восстановлен в MioFlow со всеми данными. Страница записи: ${env.PUBLIC_WEB_URL}/b/${slug}`);
    return { ok: true, slug };
  }

  /** Название, адрес страницы, тариф — по просьбе салона */
  @HttpCode(200)
  @Post(':id/edit')
  async edit(@Req() req: Admin, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(withConfirm({
    name: z.string().trim().min(1).max(100).optional(),
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, 'Адрес: латиница, цифры и дефис, 3–40 символов').optional(),
    planCode: z.string().max(32).optional(),
  }))) dto: { name?: string; slug?: string; planCode?: string; password: string; code: string }) {
    await this.confirm(req.admin, dto.password, dto.code);
    const db = this.prisma.system;
    const t = await this.tenant(id);
    if (t.deletedAt) throw new AppError('DELETED', 'Салон удалён — сначала восстановите', 422);
    const changes: Record<string, unknown> = {};
    if (dto.slug && dto.slug !== t.slug) {
      if (RESERVED.has(dto.slug) || (await db.tenant.findUnique({ where: { slug: dto.slug } }))) throw conflict('SLUG_TAKEN', 'Этот адрес уже занят');
      changes.slug = { from: t.slug, to: dto.slug };
    }
    if (dto.name && dto.name !== t.name) changes.name = { from: t.name, to: dto.name };
    await db.tenant.update({ where: { id }, data: { ...(dto.name ? { name: dto.name } : {}), ...(dto.slug ? { slug: dto.slug } : {}) } });
    if (dto.planCode) {
      const plan = await db.plan.findUnique({ where: { code: dto.planCode } });
      if (!plan) throw notFound('Тариф');
      await db.subscription.update({ where: { tenantId: id }, data: { planId: plan.id } });
      changes.plan = dto.planCode;
    }
    await this.log(req, id, 'edit', changes);
    return { ok: true, changes };
  }

  /** Помощь владельцу с доступом: сменить email, прислать ссылку сброса пароля, выключить вход с кодом */
  @HttpCode(200)
  @Post(':id/owner')
  async owner_(@Req() req: Admin, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(withConfirm({
    action: z.enum(['email', 'reset-password', 'disable-2fa']),
    email: z.string().trim().toLowerCase().email().optional(),
  }))) dto: { action: 'email' | 'reset-password' | 'disable-2fa'; email?: string; password: string; code: string }) {
    await this.confirm(req.admin, dto.password, dto.code);
    const db = this.prisma.system;
    await this.tenant(id);
    const o = await this.owner(id);
    if (!o || o.deletedAt) throw notFound('Владелец');
    if (dto.action === 'email') {
      if (!dto.email) throw new AppError('VALIDATION_ERROR', 'Укажите новый email');
      if (await db.user.findUnique({ where: { email: dto.email } })) throw conflict('EMAIL_TAKEN', 'Этот email уже занят другим аккаунтом');
      await db.user.update({ where: { id: o.id }, data: { email: dto.email } });
      // Старые сессии — выйти: email сменили, потому что доступ мог попасть к чужим
      await db.refreshToken.updateMany({ where: { userId: o.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.log(req, id, 'owner_email', { from: o.email, to: dto.email });
      this.notify(o.email, 'Email для входа в MioFlow изменён', `По вашему обращению email для входа изменён на ${dto.email}. Если вы этого не просили — срочно напишите нам.`);
      return { ok: true };
    }
    if (dto.action === 'reset-password') {
      // Ссылка уходит только владельцу на почту — администратор её не видит
      const token = randomToken(32);
      await db.user.update({ where: { id: o.id }, data: { passwordResetHash: sha256(token), passwordResetExpires: new Date(Date.now() + 60 * 60_000) } });
      const sent = await mailer.send({ to: o.email, subject: 'Восстановление пароля — MioFlow', text: `Здравствуйте, ${o.name}!\n\nПо вашему обращению в поддержку — ссылка для нового пароля (действует 60 минут):\n${env.APP_URL}/reset?token=${token}\n\nЕсли вы не обращались — просто проигнорируйте письмо.` });
      await this.log(req, id, 'owner_reset_password', { sent });
      if (!sent) throw new AppError('MAIL_NOT_SENT', 'Письмо не отправлено: на сервере не настроена почта (SMTP_URL)', 503);
      return { ok: true };
    }
    await db.user.update({ where: { id: o.id }, data: { twoFactorEnabled: false, loginChallengeHash: null, loginCodeHash: null } });
    await this.log(req, id, 'owner_disable_2fa');
    this.notify(o.email, 'Вход с кодом выключен', 'По вашему обращению вход с кодом в MioFlow выключен. Включите его снова в «Ещё → Вход с кодом», когда восстановите доступ к телефону.');
    return { ok: true };
  }
}
