import { Body, Controller, Delete, Get, HttpCode, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import type { Response } from 'express';
import { z } from 'zod';
import { Auth, AuthCtx, Public, Roles } from '../common/auth';
import { randomToken, sha256 } from '../common/crypto';
import { AppError } from '../common/errors';
import { Zod } from '../common/http';
import { PrismaService } from '../common/prisma.service';
import { env } from '../config';
import { mailer } from '../notify/mailer';
import { AuthService } from './auth.service';

const email = z.string().trim().toLowerCase().email('Некорректный email');
const RESET_TTL_MIN = 60;

/** Восстановление пароля, push-токены, удаление аккаунта, выгрузка данных. */
@Controller()
export class AccountController {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService) {}

  /** Всегда отвечает одинаково, чтобы нельзя было проверить, зарегистрирован ли email. */
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(200)
  @Post('auth/forgot')
  async forgot(@Body(new Zod(z.object({ email }))) dto: { email: string }) {
    const user = await this.prisma.system.user.findUnique({ where: { email: dto.email } });
    if (user && !user.deletedAt) {
      const token = randomToken(32);
      await this.prisma.system.user.update({
        where: { id: user.id },
        data: { passwordResetHash: sha256(token), passwordResetExpires: new Date(Date.now() + RESET_TTL_MIN * 60_000) },
      });
      await mailer.send({
        to: user.email,
        subject: 'Восстановление пароля — MioFlow',
        text: `Здравствуйте, ${user.name}!\n\nЧтобы задать новый пароль, перейдите по ссылке (действует ${RESET_TTL_MIN} минут):\n${env.APP_URL}/reset?token=${token}\n\nЕсли вы не запрашивали восстановление, просто проигнорируйте это письмо.`,
      });
    }
    return { ok: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('auth/reset')
  async reset(@Body(new Zod(z.object({ token: z.string().min(20).max(100), password: z.string().min(8, 'Пароль — минимум 8 символов').max(128) }))) dto: { token: string; password: string }) {
    const db = this.prisma.system;
    const user = await db.user.findUnique({ where: { passwordResetHash: sha256(dto.token) } });
    if (!user || !user.passwordResetExpires || user.passwordResetExpires < new Date() || user.deletedAt) {
      throw new AppError('RESET_INVALID', 'Ссылка устарела или уже использована. Запросите новую', 400);
    }
    await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }),
        passwordResetHash: null, passwordResetExpires: null, failedLoginAttempts: 0, lockedUntil: null,
      },
    });
    // Все старые сессии — выйти (на случай, если пароль был скомпрометирован).
    await this.auth.revokeAllSessions(user.id);
    return { ok: true };
  }

  @Post('me/push-tokens')
  async addPushToken(@Auth() a: AuthCtx, @Body(new Zod(z.object({ token: z.string().regex(/^Expo(nent)?PushToken\[.+\]$/), platform: z.enum(['ios', 'android']) }))) dto: { token: string; platform: string }) {
    await this.prisma.system.pushToken.upsert({
      where: { token: dto.token },
      update: { userId: a.userId, platform: dto.platform },
      create: { userId: a.userId, token: dto.token, platform: dto.platform },
    });
    return { ok: true };
  }

  @HttpCode(200)
  @Post('me/push-tokens/remove')
  async removePushToken(@Auth() a: AuthCtx, @Body(new Zod(z.object({ token: z.string() }))) dto: { token: string }) {
    await this.prisma.system.pushToken.deleteMany({ where: { token: dto.token, userId: a.userId } });
    return { ok: true };
  }

  /**
   * Удаление аккаунта (требование App Store / Google Play и 152-ФЗ).
   * Владелец удаляет и свои салоны: доступ закрывается сразу, данные стираются воркером через 30 дней.
   */
  @HttpCode(200)
  @Post('me/delete')
  async deleteAccount(@Auth() a: AuthCtx, @Body(new Zod(z.object({ password: z.string().min(1) }))) dto: { password: string }) {
    const db = this.prisma.system;
    const user = await db.user.findUniqueOrThrow({ where: { id: a.userId } });
    if (!(await argon2.verify(user.passwordHash, dto.password))) throw new AppError('INVALID_CREDENTIALS', 'Неверный пароль', 400);

    const now = new Date();
    await db.$transaction(async (tx) => {
      const owned = await tx.membership.findMany({ where: { userId: user.id, role: 'OWNER', deletedAt: null }, select: { tenantId: true } });
      for (const { tenantId } of owned) {
        await tx.tenant.update({ where: { id: tenantId }, data: { deletedAt: now } });
        await tx.subscription.updateMany({ where: { tenantId }, data: { status: 'CANCELLED' } });
        await tx.membership.updateMany({ where: { tenantId, deletedAt: null }, data: { deletedAt: now } });
        await tx.auditLog.create({ data: { tenantId, userId: user.id, action: 'tenant.delete', entityType: 'Tenant', entityId: tenantId } });
      }
      await tx.membership.updateMany({ where: { userId: user.id, deletedAt: null }, data: { deletedAt: now } });
      await tx.pushToken.deleteMany({ where: { userId: user.id } });
      await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
      // Обезличиваем: email освобождается, войти больше нельзя.
      await tx.user.update({
        where: { id: user.id },
        data: {
          email: `deleted-${user.id}@deleted.invalid`, name: 'Удалённый пользователь', phone: null,
          passwordHash: await argon2.hash(randomToken(32)), telegramChatId: null, telegramLinkHash: null,
          passwordResetHash: null, deletedAt: now,
        },
      });
    });
    return { ok: true };
  }

  /** Выгрузка клиентов в CSV (Excel): при переезде, по требованию салона, перед удалением. */
  @Roles('OWNER', 'MANAGER')
  @Get('tenant/export/customers.csv')
  async exportCustomers(@Auth() a: AuthCtx, @Res() res: Response) {
    const rows = await this.prisma.withTenant(a.tenantId, (tx) =>
      tx.customer.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
    );
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
      // Защита от CSV-инъекций формул в Excel
      // (номер телефона вида +79991234567 формулой не является — оставляем как есть)
      const safe = /^[=+\-@\t\r]/.test(s) && !/^\+\d{6,15}$/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const head = ['Имя', 'Телефон', 'Email', 'Визитов', 'Потратил, ₽', 'Последний визит', 'Метки', 'Заметки', 'Согласие на рассылки'];
    const lines = rows.map((c) =>
      [c.name, c.phone, c.email, c.totalVisits, (c.totalSpent / 100).toFixed(0), c.lastVisitAt, c.tags.join(', '), c.notes, c.marketingConsent ? 'да' : 'нет'].map(cell).join(';'),
    );
    await this.prisma.withTenant(a.tenantId, (tx) =>
      tx.auditLog.create({ data: { tenantId: a.tenantId, userId: a.userId, action: 'customer.export', entityType: 'Customer', after: { count: rows.length } } }),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="customers.csv"');
    res.send('﻿' + [head.map(cell).join(';'), ...lines].join('\r\n'));
  }
}

/** Воркер: окончательно стереть данные салонов, удалённых более 30 дней назад. */
export async function purgeDeletedTenants(db: import('@prisma/client').PrismaClient, now = new Date()) {
  const old = await db.tenant.findMany({ where: { deletedAt: { lt: new Date(+now - 30 * 86400_000) }, NOT: { slug: { startsWith: 'deleted-' } } }, select: { id: true } });
  for (const { id: tenantId } of old) {
    await db.$transaction([
      db.reminder.deleteMany({ where: { tenantId } }),
      db.bookingItem.deleteMany({ where: { tenantId } }),
      db.booking.deleteMany({ where: { tenantId } }),
      db.customer.deleteMany({ where: { tenantId } }),
      db.serviceResource.deleteMany({ where: { tenantId } }),
      db.service.deleteMany({ where: { tenantId } }),
      db.serviceCategory.deleteMany({ where: { tenantId } }),
      db.timeOff.deleteMany({ where: { tenantId } }),
      db.membership.deleteMany({ where: { tenantId } }),
      db.resource.deleteMany({ where: { tenantId } }),
      // Платежи и подписку оставляем (учёт доходов), салон обезличиваем.
      db.tenant.update({ where: { id: tenantId }, data: { slug: `deleted-${tenantId}`, name: 'Удалённый салон', phone: null, address: null, settings: {} } }),
    ]);
  }
  return { purged: old.length };
}
