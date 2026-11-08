import { createTemplateServices, INDUSTRIES } from '../common/industries';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { Auth, AuthCtx, Can } from '../common/auth';
import { audit } from '../common/audit';
import { AppError, notFound } from '../common/errors';
import { Zod } from '../common/http';
import { PrismaService, Tx } from '../common/prisma.service';
import { uuid } from '../common/schemas';

const serviceSchema = z.object({
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(2000).nullish(),
  /** Цена в копейках */
  price: z.number().int().min(0).max(100_000_000),
  duration: z.number().int().min(5).max(24 * 60),
  // без .default(): иначе PATCH { price } сбрасывал бы перерыв к 0 (в БД default 0)
  bufferTime: z.number().int().min(0).max(240).optional(),
  categoryId: uuid.nullish(),
  isActive: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  resourceIds: z.array(uuid).optional(),
  /** Комплекс: 2–5 обычных услуг, из которых он состоит */
  comboOf: z.array(uuid).max(5).refine((a) => a.length === 0 || a.length >= 2, 'В комплексе минимум 2 услуги').optional(),
});
const categorySchema = z.object({ name: z.string().trim().min(1).max(100), sortOrder: z.number().int().optional() });
type ServiceDto = z.infer<typeof serviceSchema>;

/** Готовые шаблоны услуг по отраслям (цены в копейках), см. src/common/industries.ts */
export const SERVICE_TEMPLATES: Record<string, (typeof INDUSTRIES)[number]['templates']> = Object.fromEntries(
  INDUSTRIES.filter((i) => i.templates.length).map((i) => [i.code, i.templates]),
);

@Controller()
export class CatalogController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('services')
  list(@Auth() a: AuthCtx) {
    return this.prisma
      .withTenant(a.tenantId, (tx) =>
        tx.service.findMany({
          where: { deletedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: { resources: { select: { resourceId: true } } },
        }),
      )
      .then((rows) => rows.map(({ resources, ...s }) => ({ ...s, resourceIds: resources.map((r) => r.resourceId) })));
  }

  @Get('services/templates')
  templates() {
    return SERVICE_TEMPLATES;
  }

  @Can('catalog.manage')
  @Post('services/from-template')
  fromTemplate(@Auth() a: AuthCtx, @Body(new Zod(z.object({ template: z.enum(Object.keys(SERVICE_TEMPLATES) as [string]) }))) dto: { template: string }) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const resources = await tx.resource.findMany({ where: { deletedAt: null }, select: { id: true } });
      return createTemplateServices(tx, a.tenantId, SERVICE_TEMPLATES[dto.template], resources.map((r) => r.id));
    });
  }

  @Can('catalog.manage')
  @Post('services')
  create(@Auth() a: AuthCtx, @Body(new Zod(serviceSchema)) dto: ServiceDto) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const { resourceIds, ...data } = dto;
      if (data.comboOf?.length) await assertCombo(tx, data.comboOf);
      const s = await tx.service.create({ data: { ...data, tenantId: a.tenantId } });
      // По умолчанию услугу оказывают все мастера.
      const ids = resourceIds ?? (await tx.resource.findMany({ where: { deletedAt: null }, select: { id: true } })).map((r) => r.id);
      await this.setResources(tx, a.tenantId, s.id, ids);
      await audit(tx, a, 'service.create', 'Service', s.id, null, s);
      return { ...s, resourceIds: ids };
    });
  }

  @Can('catalog.manage')
  @Patch('services/:id')
  update(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(serviceSchema.partial())) dto: Partial<ServiceDto>) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const before = await tx.service.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw notFound('Услуга');
      const { resourceIds, ...data } = dto;
      if (data.comboOf?.length) await assertCombo(tx, data.comboOf, id);
      const s = await tx.service.update({ where: { id }, data });
      if (resourceIds) await this.setResources(tx, a.tenantId, id, resourceIds);
      await audit(tx, a, 'service.update', 'Service', id, before, s);
      return s;
    });
  }

  @Can('catalog.manage')
  @Delete('services/:id')
  remove(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const r = await tx.service.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), isActive: false } });
      if (!r.count) throw notFound('Услуга');
      await audit(tx, a, 'service.delete', 'Service', id);
      return { ok: true };
    });
  }

  @Get('service-categories')
  categories(@Auth() a: AuthCtx) {
    return this.prisma.withTenant(a.tenantId, (tx) => tx.serviceCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }));
  }

  @Can('catalog.manage')
  @Post('service-categories')
  createCategory(@Auth() a: AuthCtx, @Body(new Zod(categorySchema)) dto: z.infer<typeof categorySchema>) {
    return this.prisma.withTenant(a.tenantId, (tx) => tx.serviceCategory.create({ data: { ...dto, tenantId: a.tenantId } }));
  }

  @Can('catalog.manage')
  @Delete('service-categories/:id')
  removeCategory(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      await tx.service.updateMany({ where: { categoryId: id }, data: { categoryId: null } });
      const r = await tx.serviceCategory.deleteMany({ where: { id } });
      if (!r.count) throw notFound('Категория');
      return { ok: true };
    });
  }

  private async setResources(tx: Tx, tenantId: string, serviceId: string, resourceIds: string[]) {
    const ids = [...new Set(resourceIds)];
    const found = await tx.resource.count({ where: { id: { in: ids }, deletedAt: null } });
    if (found !== ids.length) throw notFound('Мастер');
    await tx.serviceResource.deleteMany({ where: { serviceId } });
    if (ids.length) await tx.serviceResource.createMany({ data: ids.map((resourceId) => ({ tenantId, serviceId, resourceId })) });
  }
}

/** Комплекс собирается только из существующих обычных услуг (не из других комплексов и не из себя) */
async function assertCombo(tx: Tx, ids: string[], selfId?: string) {
  const uniq = [...new Set(ids)];
  if (uniq.length !== ids.length || (selfId && uniq.includes(selfId))) throw new AppError('VALIDATION_ERROR', 'Проверьте состав комплекса');
  const parts = await tx.service.findMany({ where: { id: { in: uniq }, deletedAt: null }, select: { comboOf: true } });
  if (parts.length !== uniq.length || parts.some((p) => p.comboOf.length)) throw new AppError('VALIDATION_ERROR', 'Комплекс собирается из обычных услуг');
}
