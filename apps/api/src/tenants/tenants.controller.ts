import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import * as argon2 from 'argon2';
import { z } from 'zod';
import { Auth, AuthCtx, Roles } from '../common/auth';
import { audit } from '../common/audit';
import { randomToken } from '../common/crypto';
import { AppError, conflict, notFound } from '../common/errors';
import { Zod } from '../common/http';
import { PrismaService } from '../common/prisma.service';
import { uuid } from '../common/schemas';
import { readSettings, tenantSettingsSchema } from '../common/tenant-settings';

const updateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().max(20).nullish(),
  address: z.string().trim().max(300).nullish(),
  timezone: z.string().optional(),
  settings: tenantSettingsSchema.partial().optional(),
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
    return { ...t, settings: readSettings(t.settings) };
  }

  @Roles('OWNER', 'MANAGER')
  @Patch('tenant')
  update(@Auth() a: AuthCtx, @Body(new Zod(updateSchema)) dto: z.infer<typeof updateSchema>) {
    if (dto.timezone) {
      try { new Intl.DateTimeFormat('ru', { timeZone: dto.timezone }); } catch {
        throw new AppError('VALIDATION_ERROR', 'Неизвестный часовой пояс');
      }
    }
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const before = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
      const settings = dto.settings ? { ...readSettings(before.settings), ...dto.settings } : undefined;
      const t = await tx.tenant.update({ where: { id: a.tenantId }, data: { ...dto, settings } });
      await audit(tx, a, 'tenant.update', 'Tenant', t.id, before, t);
      return { ...t, settings: readSettings(t.settings) };
    });
  }

  // ─── Команда ───
  @Roles('OWNER', 'MANAGER')
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
  @Roles('OWNER', 'MANAGER')
  @Post('team')
  async invite(@Auth() a: AuthCtx, @Body(new Zod(inviteSchema)) dto: z.infer<typeof inviteSchema>) {
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
    return { id: m.id, role: m.role, user: { id: user.id, email: user.email, name: user.name }, tempPassword };
  }

  @Roles('OWNER')
  @Delete('team/:id')
  async removeMember(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const m = await tx.membership.findFirst({ where: { id, deletedAt: null } });
      if (!m) throw notFound('Сотрудник');
      if (m.role === 'OWNER') throw new AppError('FORBIDDEN', 'Нельзя удалить владельца', 403);
      await tx.membership.update({ where: { id }, data: { deletedAt: new Date() } });
      await audit(tx, a, 'team.remove', 'Membership', id);
      // Сессии сотрудника в этом салоне перестанут обновляться (refresh проверяет membership).
      return { ok: true };
    });
  }
}
