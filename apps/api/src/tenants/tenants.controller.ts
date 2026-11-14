import { industry } from '../common/industries';
import { env } from '../config';
import { max, vk } from '../notify/channels';
import { telegram } from '../notify/telegram';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import * as argon2 from 'argon2';
import { z } from 'zod';
import { Auth, AuthCtx, Can, invalidatePermissions, Roles, NoDemo } from '../common/auth';
import { permissionMatrix, permissionsSchema } from '../common/permissions';
import { audit } from '../common/audit';
import { randomToken } from '../common/crypto';
import { AppError, conflict, notFound } from '../common/errors';
import { Zod } from '../common/http';
import { PrismaService } from '../common/prisma.service';
import { uuid } from '../common/schemas';
import { readSettings, tenantSettingsPatchSchema } from '../common/tenant-settings';

const updateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().max(20).nullish(),
  address: z.string().trim().max(300).nullish(),
  timezone: z.string().optional(),
  // Права ролей меняются только отдельным эндпоинтом владельца
  settings: tenantSettingsPatchSchema.omit({ permissions: true }).optional(),
});
const memberSchema = z.object({
  role: z.enum(['MANAGER', 'ADMIN', 'MASTER']).optional(),
  resourceId: uuid.nullish(),
});
const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(100),
  role: z.enum(['MANAGER', 'ADMIN', 'MASTER']),
  resourceId: uuid.nullish(),
});

@Controller()
export class TenantsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('tenant')
  async current(@Auth() a: AuthCtx) {
    const t = await this.prisma.app.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
    const settings = readSettings(t.settings);
    const ind = industry(settings.industry);
    return { ...t, settings, industry: { code: ind.code, label: ind.label, terms: ind.terms } };
  }

  @Can('settings.manage')
  @NoDemo()
  @Patch('tenant')
  update(@Auth() a: AuthCtx, @Body(new Zod(updateSchema)) dto: z.infer<typeof updateSchema>) {
    if (dto.timezone) {
      try { new Intl.DateTimeFormat('ru', { timeZone: dto.timezone }); } catch {
        throw new AppError('VALIDATION_ERROR', 'Неизвестный часовой пояс');
      }
    }
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const before = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
      const settings = dto.settings ? { ...readSettings(before.settings), ...dto.settings, permissions: readSettings(before.settings).permissions } : undefined;
      const t = await tx.tenant.update({ where: { id: a.tenantId }, data: { ...dto, settings } });
      await audit(tx, a, 'tenant.update', 'Tenant', t.id, before, t);
      return { ...t, settings: readSettings(t.settings) };
    });
  }

  // ─── Команда ───
  @Can('team.manage')
  @Get('team')
  team(@Auth() a: AuthCtx) {
    return this.prisma.withTenant(a.tenantId, (tx) =>
      tx.membership.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, resourceId: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
      }),
    );
  }

  /**
   * Приглашение сотрудника. MVP: создаём аккаунт с временным паролем, который владелец
   * передаёт сотруднику (в этапе 2 — письмо со ссылкой). Если email уже зарегистрирован —
   * просто добавляем человека в салон.
   */
  @Can('team.manage')
  @NoDemo()
  @Post('team')
  async invite(@Auth() a: AuthCtx, @Body(new Zod(inviteSchema)) dto: z.infer<typeof inviteSchema>) {
    if (dto.role === 'MANAGER' && a.role !== 'OWNER') throw new AppError('FORBIDDEN', 'Назначить управляющего может только владелец', 403);
    if (dto.resourceId) {
      const r = await this.prisma.withTenant(a.tenantId, (tx) => tx.resource.findFirst({ where: { id: dto.resourceId!, deletedAt: null } }));
      if (!r) throw notFound('Мастер');
    }
    const db = this.prisma.system;
    let user = await db.user.findUnique({ where: { email: dto.email } });
    let tempPassword: string | undefined;
    if (!user) {
      tempPassword = randomToken(9);
      user = await db.user.create({
        data: { email: dto.email, name: dto.name, passwordHash: await argon2.hash(tempPassword, { type: argon2.argon2id }) },
      });
    }
    const exists = await db.membership.findUnique({ where: { tenantId_userId: { tenantId: a.tenantId, userId: user.id } } });
    if (exists && !exists.deletedAt) throw conflict('ALREADY_MEMBER', 'Этот человек уже в команде');
    const m = exists
      ? await db.membership.update({ where: { id: exists.id }, data: { deletedAt: null, role: dto.role, resourceId: dto.resourceId ?? null } })
      : await db.membership.create({ data: { tenantId: a.tenantId, userId: user.id, role: dto.role, resourceId: dto.resourceId ?? null } });
    await db.auditLog.create({ data: { tenantId: a.tenantId, userId: a.userId, action: 'team.invite', entityType: 'Membership', entityId: m.id } });
    // Имя уже зарегистрированного человека не раскрываем — показываем то, что ввёл приглашающий
    return { id: m.id, role: m.role, user: { id: user.id, email: user.email, name: tempPassword ? user.name : dto.name }, tempPassword };
  }

  /** Сменить роль сотрудника или привязку к мастеру */
  @Can('team.manage')
  @NoDemo()
  @Patch('team/:id')
  async updateMember(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(memberSchema)) dto: z.infer<typeof memberSchema>) {
    if (dto.role === 'MANAGER' && a.role !== 'OWNER') throw new AppError('FORBIDDEN', 'Назначить управляющего может только владелец', 403);
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const m = await tx.membership.findFirst({ where: { id, deletedAt: null } });
      if (!m) throw notFound('Сотрудник');
      if (m.role === 'OWNER') throw new AppError('FORBIDDEN', 'Права владельца изменить нельзя', 403);
      if (m.userId === a.userId) throw new AppError('FORBIDDEN', 'Нельзя менять собственную роль', 403);
      if (m.role === 'MANAGER' && a.role !== 'OWNER') throw new AppError('FORBIDDEN', 'Управляющего может изменить только владелец', 403);
      if (dto.resourceId && !(await tx.resource.findFirst({ where: { id: dto.resourceId, deletedAt: null } }))) throw notFound('Мастер');
      const upd = await tx.membership.update({
        where: { id },
        data: { ...(dto.role ? { role: dto.role } : {}), ...(dto.resourceId !== undefined ? { resourceId: dto.resourceId } : {}) },
        select: { id: true, role: true, resourceId: true, user: { select: { id: true, name: true, email: true } } },
      });
      await audit(tx, a, 'team.update', 'Membership', id, { role: m.role, resourceId: m.resourceId }, { role: upd.role, resourceId: upd.resourceId });
      // Роль в уже выданном access-токене обновится при следующем refresh (до 15 минут)
      return upd;
    });
  }

  /** Ссылки для записи через мессенджеры: салон ставит их в свой канал, группу, профиль */
  @Get('tenant/booking-links')
  async bookingLinks(@Auth() a: AuthCtx) {
    const t = await this.prisma.app.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { slug: true } });
    const payload = `s_${t.slug}`;
    return {
      web: `${env.PUBLIC_WEB_URL}/b/${t.slug}`,
      telegram: telegram.enabled ? telegram.deepLink(payload) : null,
      max: max.enabled ? max.deepLink(payload) : null,
      vk: vk.enabled ? vk.deepLink(payload) : null,
    };
  }

  // ─── Роли и доступы ───
  @Get('tenant/permissions')
  async permissions(@Auth() a: AuthCtx) {
    const t = await this.prisma.withTenant(a.tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId } }));
    return permissionMatrix(readSettings(t.settings).permissions);
  }

  @Roles('OWNER')
  @NoDemo()
  @Put('tenant/permissions')
  setPermissions(@Auth() a: AuthCtx, @Body(new Zod(z.object({ permissions: permissionsSchema }))) dto: { permissions: z.infer<typeof permissionsSchema> }) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const before = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
      const prev = readSettings(before.settings);
      const permissions = { ...(prev.permissions ?? {}) };
      for (const [role, perms] of Object.entries(dto.permissions)) permissions[role as keyof typeof permissions] = { ...(permissions[role as keyof typeof permissions] ?? {}), ...perms };
      await tx.tenant.update({ where: { id: a.tenantId }, data: { settings: { ...prev, permissions } } });
      await audit(tx, a, 'tenant.permissions', 'Tenant', a.tenantId, prev.permissions ?? null, permissions);
      invalidatePermissions(a.tenantId);
      return permissionMatrix(permissions);
    });
  }

  @Can('team.manage')
  @NoDemo()
  @Delete('team/:id')
  async removeMember(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const m = await tx.membership.findFirst({ where: { id, deletedAt: null } });
      if (!m) throw notFound('Сотрудник');
      if (m.role === 'OWNER') throw new AppError('FORBIDDEN', 'Нельзя удалить владельца', 403);
      if (m.role === 'MANAGER' && a.role !== 'OWNER') throw new AppError('FORBIDDEN', 'Управляющего может удалить только владелец', 403);
      await tx.membership.update({ where: { id }, data: { deletedAt: new Date() } });
      await audit(tx, a, 'team.remove', 'Membership', id);
      // Сессии сотрудника в этом салоне перестанут обновляться (refresh проверяет membership).
      return { ok: true };
    });
  }
}
