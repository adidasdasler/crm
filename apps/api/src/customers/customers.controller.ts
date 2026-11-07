import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Auth, AuthCtx, Can, can } from '../common/auth';
import { maskEmail, maskPhone } from '../common/permissions';
import { audit } from '../common/audit';
import { conflict, isUniqueError, notFound } from '../common/errors';
import { Paged, Zod } from '../common/http';
import { normalizePhone } from '../common/phone';
import { PrismaService } from '../common/prisma.service';
import { pageQuery, phone } from '../common/schemas';

const customerSchema = z.object({
  name: z.string().trim().min(1).max(150),
  phone,
  email: z.string().trim().toLowerCase().email().nullish(),
  birthDate: z.coerce.date().nullish(),
  notes: z.string().max(5000).nullish(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  marketingConsent: z.boolean().optional(),
});
type Dto = z.infer<typeof customerSchema>;
const listQuery = pageQuery.extend({ q: z.string().trim().max(100).optional(), tag: z.string().optional() });
const importSchema = z.object({
  customers: z.array(z.object({ name: z.string(), phone: z.string(), email: z.string().optional(), notes: z.string().optional() })).max(5000),
});

@Controller('customers')
export class CustomersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Auth() a: AuthCtx, @Query(new Zod(listQuery)) q: z.infer<typeof listQuery>): Promise<Paged<unknown>> {
    const digits = q.q?.replace(/\D/g, '');
    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
      // Без права на всю базу — только клиенты, которые записывались к этому сотруднику
      ...(can(a, 'customers.view') ? {} : { bookings: { some: { resourceId: a.resourceId ?? NO_ID } } }),
      ...(q.tag ? { tags: { has: q.tag } } : {}),
      ...(q.q
        ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, ...(digits && digits.length >= 3 ? [{ phone: { contains: digits } }] : [])] }
        : {}),
    };
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const [items, total] = await Promise.all([
        tx.customer.findMany({ where, orderBy: [{ lastVisitAt: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }], skip: (q.page - 1) * q.limit, take: q.limit }),
        tx.customer.count({ where }),
      ]);
      return { items: items.map((c) => maskCustomer(a, c)), meta: { page: q.page, limit: q.limit, total } };
    });
  }

  @Get(':id')
  async get(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string) {
    const c = await this.prisma.withTenant(a.tenantId, (tx) =>
      tx.customer.findFirst({
        where: { id, deletedAt: null, ...ownOnly(a) },
        include: {
          bookings: {
            where: can(a, 'bookings.all') ? {} : { resourceId: a.resourceId ?? NO_ID },
            orderBy: { startsAt: 'desc' },
            take: 50,
            include: { items: true, resource: { select: { id: true, name: true } } },
          },
        },
      }),
    );
    if (!c) throw notFound('Клиент');
    return maskCustomer(a, c);
  }

  @Post()
  create(@Auth() a: AuthCtx, @Body(new Zod(customerSchema)) dto: Dto) {
    return this.prisma
      .withTenant(a.tenantId, async (tx) => {
        const c = await tx.customer.create({ data: { ...dto, tenantId: a.tenantId } });
        await audit(tx, a, 'customer.create', 'Customer', c.id);
        return c;
      })
      .catch((e) => {
        if (isUniqueError(e)) throw conflict('CUSTOMER_EXISTS', 'Клиент с таким телефоном уже есть');
        throw e;
      });
  }

  @Patch(':id')
  update(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(customerSchema.partial())) dto: Partial<Dto>) {
    return this.prisma
      .withTenant(a.tenantId, async (tx) => {
        const before = await tx.customer.findFirst({ where: { id, deletedAt: null, ...ownOnly(a) } });
        if (!before) throw notFound('Клиент');
        // Без права на контакты менять телефон и email нельзя (их не видно)
        const data = can(a, 'customers.contacts') ? dto : { ...dto, phone: undefined, email: undefined };
        const c = await tx.customer.update({ where: { id }, data });
        await audit(tx, a, 'customer.update', 'Customer', id, before, c);
        return maskCustomer(a, c);
      })
      .catch((e) => {
        if (isUniqueError(e)) throw conflict('CUSTOMER_EXISTS', 'Клиент с таким телефоном уже есть');
        throw e;
      });
  }

  /** Удаление по запросу субъекта ПДн: обезличиваем, историю визитов сохраняем для отчётов. */
  @Can('customers.view')
  @Delete(':id')
  remove(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const c = await tx.customer.findFirst({ where: { id, deletedAt: null } });
      if (!c) throw notFound('Клиент');
      await tx.customer.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          name: 'Удалённый клиент',
          phone: `deleted:${id}`,
          email: null, notes: null, birthDate: null, telegramChatId: null, vkUserId: null, maxUserId: null, tags: [], marketingConsent: false,
        },
      });
      await audit(tx, a, 'customer.delete', 'Customer', id);
      return { ok: true };
    });
  }

  /** Импорт (например, выгрузка из другой CRM). Существующие по телефону — пропускаются. */
  @Can('customers.view')
  @Post('import')
  import(@Auth() a: AuthCtx, @Body(new Zod(importSchema)) dto: z.infer<typeof importSchema>) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const rows = new Map<string, (typeof dto.customers)[number]>();
      const invalid: string[] = [];
      for (const c of dto.customers) {
        const p = normalizePhone(c.phone);
        if (!p || !c.name.trim()) invalid.push(c.phone);
        else rows.set(p, c);
      }
      const r = await tx.customer.createMany({
        data: [...rows].map(([p, c]) => ({
          tenantId: a.tenantId, name: c.name.trim().slice(0, 150), phone: p,
          email: c.email?.trim().toLowerCase() || null, notes: c.notes ?? null,
        })),
        skipDuplicates: true,
      });
      await audit(tx, a, 'customer.import', 'Customer', null, null, { created: r.count });
      return { created: r.count, skipped: rows.size - r.count, invalid: invalid.length };
    });
  }
}

const NO_ID = '00000000-0000-0000-0000-000000000000';
const ownOnly = (a: AuthCtx): Prisma.CustomerWhereInput =>
  can(a, 'customers.view') ? {} : { bookings: { some: { resourceId: a.resourceId ?? NO_ID } } };

function maskCustomer<T extends { phone: string; email: string | null }>(a: AuthCtx, c: T): T {
  return can(a, 'customers.contacts') ? c : { ...c, phone: maskPhone(c.phone)!, email: maskEmail(c.email) ?? null };
}
