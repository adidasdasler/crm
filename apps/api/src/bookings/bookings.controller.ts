import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Auth, AuthCtx } from '../common/auth';
import { forbidden, notFound } from '../common/errors';
import { Zod } from '../common/http';
import { PrismaService, Tx } from '../common/prisma.service';
import { phone, uuid } from '../common/schemas';
import { bookingInclude, BookingsService } from './bookings.service';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Формат даты YYYY-MM-DD');
const listQuery = z
  .object({ from: z.coerce.date(), to: z.coerce.date(), resourceId: uuid.optional(), customerId: uuid.optional() })
  .refine((q) => q.from < q.to && +q.to - +q.from <= 62 * 86400_000, 'Период — не более 62 дней');
const slotsQuery = z.object({
  date: isoDate,
  serviceIds: z.string().transform((s) => s.split(',').filter(Boolean)).pipe(z.array(uuid).min(1).max(10)),
  resourceId: uuid.optional(),
});
const createSchema = z
  .object({
    customerId: uuid.optional(),
    /** Быстрое создание клиента прямо из записи */
    customer: z.object({ name: z.string().trim().min(1).max(150), phone }).optional(),
    resourceId: uuid.nullable(),
    serviceIds: z.array(uuid).min(1).max(10),
    startsAt: z.coerce.date(),
    price: z.number().int().min(0).optional(),
    notes: z.string().max(2000).nullish(),
    allowOutsideSchedule: z.boolean().optional(),
  })
  .refine((v) => v.customerId || v.customer, 'Укажите клиента');
const updateSchema = z.object({
  version: z.number().int().min(0),
  startsAt: z.coerce.date().optional(),
  resourceId: uuid.optional(),
  serviceIds: z.array(uuid).min(1).max(10).optional(),
  price: z.number().int().min(0).optional(),
  notes: z.string().max(2000).nullish(),
  allowOutsideSchedule: z.boolean().optional(),
});
const statusSchema = z.object({
  status: z.enum(['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']),
  version: z.number().int().min(0).optional(),
});

@Controller('bookings')
export class BookingsController {
  constructor(private readonly prisma: PrismaService, private readonly bookings: BookingsService) {}

  @Get()
  list(@Auth() a: AuthCtx, @Query(new Zod(listQuery)) q: z.infer<typeof listQuery>) {
    const where: Prisma.BookingWhereInput = {
      startsAt: { lt: q.to },
      endsAt: { gt: q.from },
      ...(q.customerId ? { customerId: q.customerId } : {}),
      // Мастер видит только свои записи.
      resourceId: a.role === 'MASTER' ? a.resourceId ?? '00000000-0000-0000-0000-000000000000' : q.resourceId,
    };
    return this.prisma.withTenant(a.tenantId, (tx) =>
      tx.booking.findMany({ where, include: bookingInclude, orderBy: { startsAt: 'asc' } }),
    );
  }

  @Get('slots')
  slots(@Auth() a: AuthCtx, @Query(new Zod(slotsQuery)) q: z.infer<typeof slotsQuery>) {
    return this.prisma.withTenant(a.tenantId, async (tx) =>
      this.bookings.slots(tx, await this.tenant(tx, a), { ...q, ignoreLead: true }),
    );
  }

  @Get(':id')
  async get(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string) {
    const b = await this.prisma.withTenant(a.tenantId, (tx) =>
      tx.booking.findUnique({ where: { id }, include: { ...bookingInclude, reminders: true } }),
    );
    if (!b || (a.role === 'MASTER' && b.resourceId !== a.resourceId)) throw notFound('Запись');
    return b;
  }

  @Post()
  create(@Auth() a: AuthCtx, @Body(new Zod(createSchema)) dto: z.infer<typeof createSchema>) {
    if (a.role === 'MASTER' && dto.resourceId !== a.resourceId) throw forbidden('Мастер может записывать только к себе');
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      let customerId = dto.customerId;
      if (!customerId && dto.customer) {
        const existing = await tx.customer.findFirst({ where: { phone: dto.customer.phone, deletedAt: null } });
        customerId = existing?.id
          ?? (await tx.customer.create({ data: { tenantId: a.tenantId, ...dto.customer, source: 'MANUAL' } })).id;
      }
      return this.bookings.create(tx, await this.tenant(tx, a), a, {
        customerId: customerId!,
        resourceId: dto.resourceId,
        serviceIds: dto.serviceIds,
        startsAt: dto.startsAt,
        price: dto.price,
        notes: dto.notes,
        source: 'MANUAL',
        allowOutsideSchedule: dto.allowOutsideSchedule,
      });
    });
  }

  @Patch(':id')
  update(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(updateSchema)) dto: z.infer<typeof updateSchema>) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      await this.assertMasterOwns(tx, a, id, dto.resourceId);
      return this.bookings.update(tx, await this.tenant(tx, a), a, id, dto);
    });
  }

  @Post(':id/status')
  status(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(statusSchema)) dto: z.infer<typeof statusSchema>) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      await this.assertMasterOwns(tx, a, id);
      return this.bookings.transition(tx, a, id, dto.status, dto.version);
    });
  }

  private async assertMasterOwns(tx: Tx, a: AuthCtx, id: string, newResourceId?: string) {
    if (a.role !== 'MASTER') return;
    const b = await tx.booking.findUnique({ where: { id }, select: { resourceId: true } });
    if (!b || b.resourceId !== a.resourceId) throw notFound('Запись');
    if (newResourceId && newResourceId !== a.resourceId) throw forbidden('Мастер не может передать запись другому');
  }

  private tenant(tx: Tx, a: AuthCtx) {
    return tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { id: true, timezone: true, settings: true } });
  }
}
