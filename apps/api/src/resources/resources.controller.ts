import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { cleanJpeg, storage } from '../media/storage';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { Auth, AuthCtx, Can, can, NoDemo } from '../common/auth';
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
  .object({
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    reason: z.string().trim().max(200).nullish(),
    /** Повторять в то же время каждый день до этой даты включительно (например, обед) */
    repeatUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    /** Закрыть, даже если на это время уже есть записи */
    force: z.boolean().optional(),
  })
  .refine((v) => v.startsAt < v.endsAt, 'Начало должно быть раньше конца')
  .refine((v) => +v.endsAt - +v.startsAt <= 31 * 86400_000, 'Не больше месяца за раз');

type Dto = z.infer<typeof base>;

/** Палитра мастеров по умолчанию (как в приложении, docs/BRAND.md) */
export const MASTER_COLORS = ['#2F3BFF', '#FF6F91', '#00A884', '#FF9F1C', '#7B61FF', '#0EA5E9', '#B5179E', '#5A5E7E'];

@Controller('resources')
export class ResourcesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Auth() a: AuthCtx, @Query('all') all?: string) {
    const [rows, t] = await this.prisma.withTenant(a.tenantId, (tx) => Promise.all([
      tx.resource.findMany({
        where: { deletedAt: null, ...(all ? {} : { isActive: true }) },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { services: { select: { serviceId: true } } },
      }),
      tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { slug: true } }),
    ]));
    return rows.map(({ services, photoKey, photoConsent: _c, photoConsentAt: _ca, photoConsentBy: _cb, ...r }) => ({ ...r, photoUrl: masterPhotoUrl(t.slug, r.id, photoKey), serviceIds: services.map((s) => s.serviceId) }));
  }

  /**
   * Фото мастера: загружает владелец/управляющий или сам мастер. Картинка готовится на телефоне
   * (квадрат до 800 px, JPEG), сервер проверяет, что это JPEG, и вырезает метаданные.
   */
  @NoDemo()
  @Post(':id/photo')
  @UseInterceptors(FileInterceptor('photo', { storage: memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  async setPhoto(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined, @Body() body: { consent?: string }) {
    const own = a.resourceId === id;
    if (!can(a, 'staff.manage') && !own) throw new AppError('FORBIDDEN', 'Менять можно только своё фото', 403);
    // Фото с именем на странице записи — распространение персональных данных: нужно отдельное согласие мастера
    const consent = own ? 'self' : 'written';
    if (body?.consent !== consent) {
      throw new AppError('CONSENT_REQUIRED', own ? 'Подтвердите согласие на показ фото клиентам' : 'Подтвердите, что у вас есть письменное согласие мастера', 400);
    }
    const img = file?.buffer && cleanJpeg(file.buffer);
    if (!img) throw new AppError('VALIDATION_ERROR', 'Нужно фото в формате JPEG');
    if (img.width > 1600 || img.height > 1600) throw new AppError('VALIDATION_ERROR', 'Слишком большое изображение');
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const r = await tx.resource.findFirst({ where: { id, deletedAt: null } });
      if (!r) throw notFound('Мастер');
      // Новое имя файла при каждой загрузке — браузеры не покажут старое фото из кэша
      const key = `${a.tenantId}/${randomUUID()}-thumb.jpg`;
      await storage.put(key, img.data);
      await tx.resource.update({ where: { id }, data: { photoKey: key, photoConsent: consent, photoConsentAt: new Date(), photoConsentBy: a.userId } });
      if (r.photoKey) await storage.remove(r.photoKey).catch(() => null);
      await audit(tx, a, 'resource.photo', 'Resource', id, undefined, { consent });
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { slug: true } });
      return { photoUrl: masterPhotoUrl(t.slug, id, key) };
    });
  }

  @Delete(':id/photo')
  async removePhoto(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string) {
    if (!can(a, 'staff.manage') && a.resourceId !== id) throw new AppError('FORBIDDEN', 'Менять можно только своё фото', 403);
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const r = await tx.resource.findFirst({ where: { id, deletedAt: null } });
      if (!r) throw notFound('Мастер');
      if (r.photoKey) {
        // Удаление фото — это и отзыв согласия
        await tx.resource.update({ where: { id }, data: { photoKey: null, photoConsent: null, photoConsentAt: null, photoConsentBy: null } });
        await storage.remove(r.photoKey).catch(() => null);
        await audit(tx, a, 'resource.photo_delete', 'Resource', id);
      }
      return { ok: true };
    });
  }

  /** Закрытое время всех мастеров за день — для календаря. Мастер без права «все записи» видит только своё. */
  @Get('time-off')
  dayTimeOffs(@Auth() a: AuthCtx, @Query('date') date?: string) {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError('VALIDATION_ERROR', 'Нужна дата в формате ГГГГ-ММ-ДД');
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const { timezone: tz } = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { timezone: true } });
      const from = DateTime.fromISO(date, { zone: tz }).startOf('day');
      return tx.timeOff.findMany({
        where: {
          startsAt: { lt: from.plus({ days: 1 }).toJSDate() }, endsAt: { gt: from.toJSDate() },
          ...(can(a, 'bookings.all') ? {} : { resourceId: a.resourceId ?? '00000000-0000-0000-0000-000000000000' }),
        },
        orderBy: { startsAt: 'asc' },
      });
    });
  }

  @Get(':id')
  async get(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.prisma.withTenant(a.tenantId, (tx) =>
      tx.resource.findFirst({ where: { id, deletedAt: null }, include: { services: { select: { serviceId: true } } } }),
    );
    if (!r) throw notFound('Мастер');
    const { services, photoKey, ...rest } = r;
    const t = await this.prisma.withTenant(a.tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { slug: true } }));
    return { ...rest, photoUrl: masterPhotoUrl(t.slug, id, photoKey), serviceIds: services.map((s) => s.serviceId) };
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

  /**
   * Закрыть время вручную: перерыв, личные дела, отгул на часть дня. В это время онлайн-запись недоступна.
   * Мастер закрывает своё время, сотрудник с правом «мастера и графики» — любое.
   */
  @Post(':id/time-off')
  addTimeOff(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(timeOffSchema)) dto: z.infer<typeof timeOffSchema>) {
    if (!can(a, 'staff.manage') && a.resourceId !== id) throw new AppError('FORBIDDEN', 'Закрывать можно только своё время', 403);
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      if (!(await tx.resource.findFirst({ where: { id, deletedAt: null } }))) throw notFound('Мастер');
      const { timezone: tz } = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { timezone: true } });
      // Интервалы: один или тот же отрезок каждый день до repeatUntil (не больше 92 дней)
      const first = DateTime.fromJSDate(dto.startsAt).setZone(tz);
      const len = +dto.endsAt - +dto.startsAt;
      const days = dto.repeatUntil ? Math.floor(DateTime.fromISO(dto.repeatUntil, { zone: tz }).startOf('day').diff(first.startOf('day'), 'days').days) + 1 : 1;
      if (days < 1 || days > 92) throw new AppError('VALIDATION_ERROR', 'Повтор — от 1 до 92 дней');
      const items = Array.from({ length: days }, (_, i) => {
        const s = first.plus({ days: i });
        return { startsAt: s.toJSDate(), endsAt: new Date(+s.toJSDate() + len) };
      });
      // Не закрываем молча время, на которое уже записаны клиенты
      const busy = await tx.booking.count({
        where: { resourceId: id, status: { in: ['SCHEDULED', 'CONFIRMED', 'ARRIVED'] }, OR: items.map((t) => ({ startsAt: { lt: t.endsAt }, endsAt: { gt: t.startsAt } })) },
      });
      if (busy && !dto.force) {
        throw new AppError('BOOKINGS_IN_TIME_OFF', `На это время уже есть записи: ${busy}. Перенесите их или закройте время всё равно`, 409, { count: busy });
      }
      await tx.timeOff.createMany({ data: items.map((t) => ({ ...t, reason: dto.reason ?? null, tenantId: a.tenantId, resourceId: id })) });
      await audit(tx, a, 'timeoff.create', 'Resource', id, null, { count: items.length, from: dto.startsAt, reason: dto.reason });
      return { created: items.length, bookingsInside: busy };
    });
  }

  @Delete(':id/time-off/:timeOffId')
  removeTimeOff(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string, @Param('timeOffId', ParseUUIDPipe) timeOffId: string) {
    if (!can(a, 'staff.manage') && a.resourceId !== id) throw new AppError('FORBIDDEN', 'Открывать можно только своё время', 403);
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const r = await tx.timeOff.deleteMany({ where: { id: timeOffId, resourceId: id } });
      if (!r.count) throw notFound('Закрытое время');
      await audit(tx, a, 'timeoff.delete', 'Resource', id, null, { timeOffId });
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

/** Публичная ссылка на фото мастера; ?v= меняется вместе с файлом, поэтому кэш браузера всегда свежий */
export const masterPhotoUrl = (slug: string, id: string, key: string | null) =>
  key ? `/v1/public/${slug}/masters/${id}/photo?v=${key.split('/')[1].slice(0, 8)}` : null;

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
