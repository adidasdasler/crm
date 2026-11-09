import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { Auth, AuthCtx, Can } from '../common/auth';
import { audit } from '../common/audit';
import { AppError, notFound } from '../common/errors';
import { Zod } from '../common/http';
import { PrismaService, Tx } from '../common/prisma.service';
import { DEFAULT_SCHEDULE, uuid, scheduleSchema } from '../common/schemas';

const base = z.object({
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(20).nullish(),
  position: z.string().trim().max(100).nullish(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  schedule: scheduleSchema.optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  serviceIds: z.array(uuid).optional(),
});
const timeOffSchema = z
  .object({ startsAt: z.coerce.date(), endsAt: z.coerce.date(), reason: z.string().max(200).nullish() })
  .refine((v) => v.startsAt < v.endsAt, 'Начало должно быть раньше конца');

type Dto = z.infer<typeof base>;

/** Палитра мастеров по умолчанию (как в приложении, docs/BRAND.md) */
export const MASTER_COLORS = ['#2F3BFF', '#FF6F91', '#00A884', '#FF9F1C', '#7B61FF', '#0EA5E9', '#B5179E', '#5A5E7E'];

@Controller('resources')
export class ResourcesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Auth() a: AuthCtx, @Query('all') all?: string) {
    return this.prisma.withTenant(a.tenantId, (tx) =>
      tx.resource.findMany({
        where: { deletedAt: null, ...(all ? {} : { isActive: true }) },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { services: { select: { serviceId: true } } },
      }),
    ).then((rows) => rows.map(({ services, ...r }) => ({ ...r, serviceIds: services.map((s) => s.serviceId) })));
  }

  @Get(':id')
  async get(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.prisma.withTenant(a.tenantId, (tx) =>
      tx.resource.findFirst({ where: { id, deletedAt: null }, include: { services: { select: { serviceId: true } } } }),
    );
    if (!r) throw notFound('Мастер');
    const { services, ...rest } = r;
    return { ...rest, serviceIds: services.map((s) => s.serviceId) };
  }

  @Can('staff.manage')
  @Post()
  create(@Auth() a: AuthCtx, @Body(new Zod(base)) dto: Dto) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const { serviceIds, ...data } = dto;
      await assertMastersLimit(tx, a.tenantId, dto.isActive === false ? 0 : 1);
      const count = await tx.resource.count();
      const r = await tx.resource.create({
        data: { ...data, color: dto.color ?? MASTER_COLORS[count % MASTER_COLORS.length], tenantId: a.tenantId, schedule: dto.schedule ?? DEFAULT_SCHEDULE },
      });
      if (serviceIds?.length) await this.setServices(tx, a.tenantId, r.id, serviceIds);
      await audit(tx, a, 'resource.create', 'Resource', r.id, null, r);
      return r;
    });
  }

  @Can('staff.manage')
  @Patch(':id')
  update(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(base.partial())) dto: Partial<Dto>) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const before = await tx.resource.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw notFound('Мастер');
      const { serviceIds, ...data } = dto;
      if (dto.isActive && !before.isActive) await assertMastersLimit(tx, a.tenantId, 1);
      const r = await tx.resource.update({ where: { id }, data });
      if (serviceIds) await this.setServices(tx, a.tenantId, id, serviceIds);
      await audit(tx, a, 'resource.update', 'Resource', id, before, r);
      return r;
    });
  }

  @Can('staff.manage')
  @Delete(':id')
  remove(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const r = await tx.resource.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), isActive: false } });
      if (!r.count) throw notFound('Мастер');
      await audit(tx, a, 'resource.delete', 'Resource', id);
      return { ok: true };
    });
  }

  @Can('staff.manage')
  @Put(':id/services')
  services(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(z.object({ serviceIds: z.array(uuid) }))) dto: { serviceIds: string[] }) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      if (!(await tx.resource.findFirst({ where: { id, deletedAt: null } }))) throw notFound('Мастер');
      await this.setServices(tx, a.tenantId, id, dto.serviceIds);
      return { serviceIds: dto.serviceIds };
    });
  }

  // ─── Исключения из графика ───
  @Get(':id/time-off')
  timeOffs(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(a.tenantId, (tx) =>
      tx.timeOff.findMany({ where: { resourceId: id, endsAt: { gte: new Date() } }, orderBy: { startsAt: 'asc' } }),
    );
  }

  @Can('staff.manage')
  @Post(':id/time-off')
  addTimeOff(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(timeOffSchema)) dto: z.infer<typeof timeOffSchema>) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      if (!(await tx.resource.findFirst({ where: { id, deletedAt: null } }))) throw notFound('Мастер');
      return tx.timeOff.create({ data: { ...dto, tenantId: a.tenantId, resourceId: id } });
    });
  }

  @Can('staff.manage')
  @Delete(':id/time-off/:timeOffId')
  removeTimeOff(@Auth() a: AuthCtx, @Param('timeOffId', ParseUUIDPipe) timeOffId: string) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const r = await tx.timeOff.deleteMany({ where: { id: timeOffId } });
      if (!r.count) throw notFound('Исключение');
      return { ok: true };
    });
  }

  private async setServices(tx: Tx, tenantId: string, resourceId: string, serviceIds: string[]) {
    const found = await tx.service.count({ where: { id: { in: serviceIds }, deletedAt: null } });
    if (found !== new Set(serviceIds).size) throw notFound('Услуга');
    await tx.serviceResource.deleteMany({ where: { resourceId } });
    await tx.serviceResource.createMany({
      data: [...new Set(serviceIds)].map((serviceId) => ({ tenantId, resourceId, serviceId })),
    });
  }
}

/** Ограничение тарифа по числу активных мастеров. */
async function assertMastersLimit(tx: Tx, tenantId: string, adding: number) {
  if (!adding) return;
  const sub = await tx.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
  const limit = Number((sub?.plan.limits as { masters?: number } | undefined)?.masters ?? Infinity);
  const active = await tx.resource.count({ where: { deletedAt: null, isActive: true } });
  if (active + adding > limit) {
    throw new AppError('PLAN_LIMIT', `На тарифе «${sub!.plan.name}» можно до ${limit} мастеров. Перейдите на тариф выше в разделе «Подписка»`, 403);
  }
}
