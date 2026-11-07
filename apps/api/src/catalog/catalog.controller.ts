import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { Auth, AuthCtx, Can } from '../common/auth';
import { audit } from '../common/audit';
import { notFound } from '../common/errors';
import { Zod } from '../common/http';
import { PrismaService, Tx } from '../common/prisma.service';
import { uuid } from '../common/schemas';

const serviceSchema = z.object({
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(2000).nullish(),
  /** Цена в копейках */
  price: z.number().int().min(0).max(100_000_000),
  duration: z.number().int().min(5).max(24 * 60),
  bufferTime: z.number().int().min(0).max(240).default(0),
  categoryId: uuid.nullish(),
  isActive: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  resourceIds: z.array(uuid).optional(),
});
const categorySchema = z.object({ name: z.string().trim().min(1).max(100), sortOrder: z.number().int().optional() });
type ServiceDto = z.infer<typeof serviceSchema>;

/** Готовые шаблоны для онбординга (цены в копейках). */
export const SERVICE_TEMPLATES: Record<string, { name: string; price: number; duration: number; bufferTime?: number }[]> = {
  nails: [
    { name: 'Маникюр без покрытия', price: 120000, duration: 60 },
    { name: 'Маникюр с покрытием гель-лак', price: 220000, duration: 120, bufferTime: 10 },
    { name: 'Педикюр с покрытием', price: 280000, duration: 120, bufferTime: 10 },
    { name: 'Снятие покрытия', price: 30000, duration: 15 },
  ],
  hair: [
    { name: 'Женская стрижка', price: 200000, duration: 60 },
    { name: 'Мужская стрижка', price: 120000, duration: 45 },
    { name: 'Окрашивание в один тон', price: 450000, duration: 150, bufferTime: 15 },
    { name: 'Укладка', price: 150000, duration: 45 },
  ],
  brows: [
    { name: 'Коррекция бровей', price: 80000, duration: 30 },
    { name: 'Окрашивание бровей', price: 70000, duration: 30 },
    { name: 'Ламинирование ресниц', price: 250000, duration: 75 },
  ],
  barber: [
    { name: 'Мужская стрижка', price: 150000, duration: 60 },
    { name: 'Стрижка бороды', price: 100000, duration: 30 },
    { name: 'Стрижка + борода', price: 230000, duration: 90 },
  ],
};

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
      const created = [];
      for (const t of SERVICE_TEMPLATES[dto.template]) {
        const s = await tx.service.create({ data: { ...t, tenantId: a.tenantId } });
        await this.setResources(tx, a.tenantId, s.id, resources.map((r) => r.id));
        created.push(s);
      }
      return created;
    });
  }

  @Can('catalog.manage')
  @Post('services')
  create(@Auth() a: AuthCtx, @Body(new Zod(serviceSchema)) dto: ServiceDto) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const { resourceIds, ...data } = dto;
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
