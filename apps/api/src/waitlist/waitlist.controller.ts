import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { z } from 'zod';
import { Auth, AuthCtx, can } from '../common/auth';
import { AppError, notFound } from '../common/errors';
import { Zod } from '../common/http';
import { PrismaService } from '../common/prisma.service';

/** Лист ожидания в приложении: кто ждёт окно в этот день */
@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Auth() a: AuthCtx, @Query('date') date?: string) {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError('VALIDATION_ERROR', 'Нужна дата в формате ГГГГ-ММ-ДД');
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const rows = await tx.waitlistEntry.findMany({
        where: {
          date: new Date(`${date}T00:00:00Z`), status: { in: ['ACTIVE', 'NOTIFIED'] },
          // Мастер без права «все записи» видит только ожидающих его или «любого мастера»
          ...(can(a, 'bookings.all') ? {} : { OR: [{ resourceId: a.resourceId ?? '00000000-0000-0000-0000-000000000000' }, { resourceId: null }] }),
        },
        orderBy: { createdAt: 'asc' },
      });
      const services = await tx.service.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => r.serviceIds))] } }, select: { id: true, name: true } });
      const names = new Map(services.map((s) => [s.id, s.name]));
      const masked = !can(a, 'customers.contacts');
      return rows.map((r) => ({
        id: r.id, name: r.name, status: r.status, resourceId: r.resourceId, createdAt: r.createdAt,
        phone: masked ? r.phone.replace(/^(\+7)\d{6}(\d{2})(\d{2})$/, '$1 *** ***-$2-$3') : r.phone,
        services: r.serviceIds.map((id) => names.get(id) ?? 'Услуга'),
      }));
    });
  }

  /** Записали клиента или он больше не ждёт */
  @Patch(':id')
  update(@Auth() a: AuthCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(z.object({ status: z.enum(['DONE', 'CANCELLED']) }))) dto: { status: 'DONE' | 'CANCELLED' }) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const r = await tx.waitlistEntry.updateMany({ where: { id }, data: { status: dto.status } });
      if (!r.count) throw notFound('Заявка');
      return { ok: true };
    });
  }
}
