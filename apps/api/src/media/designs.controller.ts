import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { audit } from '../common/audit';
import { Auth, AuthCtx, can } from '../common/auth';
import { AppError, forbidden, notFound } from '../common/errors';
import { Zod } from '../common/http';
import { PrismaService, Tx } from '../common/prisma.service';
import { uuid } from '../common/schemas';
import { cleanJpeg, storage } from './storage';

const MAX_BYTES = 5 * 1024 * 1024;
const tag = z.string().trim().toLowerCase().min(1).max(30);
const metaSchema = z.object({
  title: z.string().trim().max(120).nullish(),
  tags: z.array(tag).max(15).optional(),
  serviceId: uuid.nullish(),
  resourceId: uuid.nullish(),
  bookingId: uuid.nullish(),
  materialIds: z.array(uuid).max(30).optional(),
  materialNote: z.string().trim().max(500).nullish(),
  isPublic: z.boolean().optional(),
});
const listQuery = z.object({
  tag: tag.optional(),
  resourceId: uuid.optional(),
  serviceId: uuid.optional(),
  customerId: uuid.optional(),
  q: z.string().trim().max(60).optional(),
  publicOnly: z.enum(['1']).optional(),
  limit: z.coerce.number().int().min(1).max(120).default(60),
});

type Files = { image?: Express.Multer.File[]; thumb?: Express.Multer.File[] };

/**
 * Библиотека дизайнов: фото работ с тегами, мастером, услугой и материалами.
 * Загружать может любой сотрудник; править и удалять — автор или тот, кто управляет услугами;
 * публиковать в портфолио на сайте — только с правом «услуги и цены».
 * Фото сжимается на устройстве (до 1600 px + миниатюра), сервер проверяет формат и вырезает EXIF.
 */
@Controller('designs')
export class DesignsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @UseInterceptors(FileFieldsInterceptor([{ name: 'image', maxCount: 1 }, { name: 'thumb', maxCount: 1 }], { storage: memoryStorage(), limits: { fileSize: MAX_BYTES, files: 2, fields: 5 } }))
  async create(@Auth() a: AuthCtx, @UploadedFiles() files: Files, @Body('data') raw: string) {
    let meta: z.infer<typeof metaSchema>;
    try {
      meta = metaSchema.parse(JSON.parse(raw ?? '{}'));
    } catch {
      throw new AppError('VALIDATION_ERROR', 'Некорректные данные фото');
    }
    const full = files.image?.[0] && cleanJpeg(files.image[0].buffer);
    const thumb = files.thumb?.[0] && cleanJpeg(files.thumb[0].buffer);
    if (!full || !thumb) throw new AppError('VALIDATION_ERROR', 'Нужно фото в формате JPEG');
    if (full.width > 4000 || full.height > 4000 || thumb.width > 800 || thumb.height > 800) throw new AppError('VALIDATION_ERROR', 'Слишком большое изображение');

    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const link = await this.resolveLinks(tx, a, meta);
      const id = randomUUID();
      const fileKey = `${a.tenantId}/${id}-full.jpg`, thumbKey = `${a.tenantId}/${id}-thumb.jpg`;
      await storage.put(fileKey, full.data);
      await storage.put(thumbKey, thumb.data);
      try {
        const d = await tx.design.create({
          data: {
            id, tenantId: a.tenantId, title: meta.title ?? null, tags: [...new Set(meta.tags ?? [])],
            ...link, materialIds: meta.materialIds ?? [], materialNote: meta.materialNote ?? null,
            isPublic: !!meta.isPublic && can(a, 'catalog.manage'),
            fileKey, thumbKey, width: full.width, height: full.height, createdById: a.userId,
          },
        });
        await audit(tx, a, 'design.create', 'Design', d.id);
        return d;
      } catch (e) {
        await Promise.all([storage.remove(fileKey), storage.remove(thumbKey)]);
        throw e;
      }
    });
  }

  @Get()
  list(@Auth() a: AuthCtx, @Query(new Zod(listQuery)) q: z.infer<typeof listQuery>) {
    const where: Prisma.DesignWhereInput = {
      ...(q.tag ? { tags: { has: q.tag } } : {}),
      ...(q.resourceId ? { resourceId: q.resourceId } : {}),
      ...(q.serviceId ? { serviceId: q.serviceId } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.publicOnly ? { isPublic: true } : {}),
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { tags: { has: q.q.toLowerCase() } }] } : {}),
    };
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const rows = await tx.design.findMany({ where, orderBy: { createdAt: 'desc' }, take: q.limit });
      return this.withNames(tx, a, rows);
    });
  }

  /** Теги с количеством — для фильтра */
  @Get('tags')
  tags(@Auth() a: AuthCtx) {
    return this.prisma.withTenant(a.tenantId, (tx) =>
      tx.$queryRaw<{ tag: string; count: number }[]>`
        SELECT t AS tag, count(*)::int AS count FROM "Design", unnest(tags) AS t
        WHERE "tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        GROUP BY t ORDER BY count(*) DESC, t LIMIT 50`,
    );
  }

  @Get(':id')
  async get(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const d = await tx.design.findUnique({ where: { id } });
      if (!d) throw notFound('Дизайн');
      const [view] = await this.withNames(tx, a, [d]);
      const materials = d.materialIds.length
        ? await tx.material.findMany({ where: { id: { in: d.materialIds } }, select: { id: true, name: true, unit: true } })
        : [];
      return { ...view, materials, canEdit: this.canEdit(a, d) };
    });
  }

  @Patch(':id')
  update(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(metaSchema.omit({ bookingId: true }))) dto: Omit<z.infer<typeof metaSchema>, 'bookingId'>) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const d = await tx.design.findUnique({ where: { id } });
      if (!d) throw notFound('Дизайн');
      if (!this.canEdit(a, d)) throw forbidden('Изменить фото может автор или управляющий услугами');
      if (dto.isPublic !== undefined && dto.isPublic !== d.isPublic && !can(a, 'catalog.manage')) throw forbidden('Публиковать в портфолио может управляющий услугами');
      await this.checkRefs(tx, dto);
      const r = await tx.design.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.tags ? { tags: [...new Set(dto.tags)] } : {}),
          ...(dto.serviceId !== undefined ? { serviceId: dto.serviceId } : {}),
          ...(dto.resourceId !== undefined ? { resourceId: dto.resourceId } : {}),
          ...(dto.materialIds ? { materialIds: dto.materialIds } : {}),
          ...(dto.materialNote !== undefined ? { materialNote: dto.materialNote } : {}),
          ...(dto.isPublic !== undefined ? { isPublic: dto.isPublic } : {}),
        },
      });
      await audit(tx, a, 'design.update', 'Design', id, d, r);
      return r;
    });
  }

  @Delete(':id')
  remove(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const d = await tx.design.findUnique({ where: { id } });
      if (!d) throw notFound('Дизайн');
      if (!this.canEdit(a, d)) throw forbidden('Удалить фото может автор или управляющий услугами');
      await tx.design.delete({ where: { id } });
      await audit(tx, a, 'design.delete', 'Design', id);
      await Promise.all([storage.remove(d.fileKey), storage.remove(d.thumbKey)]);
      return { ok: true };
    });
  }

  /** Сам файл. Только для сотрудников салона; кэшируется в браузере, но не в общих прокси. */
  @Get(':id/image/:size')
  async image(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string, @Param('size') size: string, @Res() res: Response) {
    const d = await this.prisma.withTenant(a.tenantId, (tx) => tx.design.findUnique({ where: { id }, select: { fileKey: true, thumbKey: true } }));
    if (!d) throw notFound('Дизайн');
    const buf = await storage.get(size === 'thumb' ? d.thumbKey : d.fileKey);
    if (!buf) throw notFound('Файл');
    res.set({ 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' }).type('image/jpeg').send(buf);
  }

  private canEdit(a: AuthCtx, d: { createdById: string | null }) {
    return d.createdById === a.userId || can(a, 'catalog.manage');
  }

  /** Привязка к визиту: клиент, мастер и услуга берутся из записи */
  private async resolveLinks(tx: Tx, a: AuthCtx, meta: z.infer<typeof metaSchema>) {
    if (meta.bookingId) {
      const b = await tx.booking.findUnique({ where: { id: meta.bookingId }, select: { customerId: true, resourceId: true, items: { select: { serviceId: true }, take: 1, orderBy: { sortOrder: 'asc' } } } });
      if (!b || (!can(a, 'bookings.all') && b.resourceId !== a.resourceId)) throw notFound('Запись');
      return { bookingId: meta.bookingId, customerId: b.customerId, resourceId: b.resourceId, serviceId: meta.serviceId ?? b.items[0]?.serviceId ?? null };
    }
    await this.checkRefs(tx, meta);
    return { bookingId: null, customerId: null, resourceId: meta.resourceId ?? a.resourceId ?? null, serviceId: meta.serviceId ?? null };
  }

  private async checkRefs(tx: Tx, m: { serviceId?: string | null; resourceId?: string | null; materialIds?: string[] }) {
    if (m.serviceId && !(await tx.service.findFirst({ where: { id: m.serviceId, deletedAt: null }, select: { id: true } }))) throw notFound('Услуга');
    if (m.resourceId && !(await tx.resource.findFirst({ where: { id: m.resourceId, deletedAt: null }, select: { id: true } }))) throw notFound('Мастер');
    if (m.materialIds?.length && (await tx.material.count({ where: { id: { in: m.materialIds } } })) !== new Set(m.materialIds).size) throw notFound('Материал');
  }

  private async withNames<T extends { serviceId: string | null; resourceId: string | null; customerId: string | null }>(tx: Tx, a: AuthCtx, rows: T[]) {
    const ids = (k: 'serviceId' | 'resourceId' | 'customerId') => [...new Set(rows.map((r) => r[k]).filter((x): x is string => !!x))];
    const [services, resources, customers] = await Promise.all([
      tx.service.findMany({ where: { id: { in: ids('serviceId') } }, select: { id: true, name: true } }),
      tx.resource.findMany({ where: { id: { in: ids('resourceId') } }, select: { id: true, name: true } }),
      // Имя клиента видит тот, кому открыта база клиентов
      can(a, 'customers.view') ? tx.customer.findMany({ where: { id: { in: ids('customerId') } }, select: { id: true, name: true } }) : Promise.resolve([]),
    ]);
    const name = (list: { id: string; name: string }[], id: string | null) => list.find((x) => x.id === id)?.name ?? null;
    return rows.map((r) => ({ ...r, service: name(services, r.serviceId), master: name(resources, r.resourceId), customer: name(customers, r.customerId) }));
  }
}
