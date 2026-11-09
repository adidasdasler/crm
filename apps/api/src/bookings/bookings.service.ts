import { settleBooking, unsettleBooking } from '../loyalty/loyalty';
import { scheduleFeedback } from '../reviews/reviews';
import { consumeForBooking, returnForBooking } from '../stock/stock';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { Booking, BookingSource, BookingStatus, Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { randomUUID } from 'node:crypto';
import { manageTokenHash } from '../common/manage-token';
import { audit } from '../common/audit';
import { AppError, conflict, isOverlapError, notFound } from '../common/errors';
import { Tx } from '../common/prisma.service';
import { readSettings } from '../common/tenant-settings';
import { computeSlots, dayBounds, fitsSchedule, Interval, WeekSchedule } from './slots';

const MIN = 60_000;
/** Статусы, которые занимают время мастера. */
export const ACTIVE_STATUSES: BookingStatus[] = ['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'COMPLETED'];

export const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  SCHEDULED: ['CONFIRMED', 'ARRIVED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['SCHEDULED', 'ARRIVED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
  ARRIVED: ['COMPLETED', 'CANCELLED', 'CONFIRMED'],
  COMPLETED: ['ARRIVED'],
  CANCELLED: ['SCHEDULED'],
  NO_SHOW: ['SCHEDULED', 'ARRIVED'],
};

export const bookingInclude = {
  items: { orderBy: { sortOrder: 'asc' } },
  customer: { select: { id: true, name: true, phone: true, notes: true, totalVisits: true } },
  resource: { select: { id: true, name: true, color: true } },
} satisfies Prisma.BookingInclude;

type Actor = { tenantId: string; userId?: string | null };
type TenantInfo = { id: string; timezone: string; settings: unknown };

export type CreateBookingInput = {
  customerId: string;
  /** null — «любой свободный мастер» */
  resourceId: string | null;
  serviceIds: string[];
  startsAt: Date;
  notes?: string | null;
  source: BookingSource;
  /** Переопределить итоговую цену (копейки) */
  price?: number;
  /** Сотрудник может поставить запись вне графика мастера */
  allowOutsideSchedule?: boolean;
  /** Источник онлайн-записи (yandex_maps, 2gis, vk…) */
  referrer?: string;
};

@Injectable()
export class BookingsService {
  /** Загрузить услуги в порядке serviceIds и посчитать длительность/буфер/цену. */
  async loadServices(tx: Tx, serviceIds: string[], onlyPublic = false) {
    const services = await tx.service.findMany({
      where: { id: { in: serviceIds }, deletedAt: null, isActive: true, ...(onlyPublic ? { isPublic: true } : {}) },
      include: { resources: { select: { resourceId: true } } },
    });
    if (services.length !== new Set(serviceIds).size) throw notFound('Услуга');
    const ordered = serviceIds.map((id) => services.find((s) => s.id === id)!);
    return {
      services: ordered,
      duration: ordered.reduce((s, x) => s + x.duration, 0),
      // Перерыв нужен один раз — после последней процедуры, берём максимальный.
      buffer: Math.max(0, ...ordered.map((x) => x.bufferTime)),
      price: ordered.reduce((s, x) => s + x.price, 0),
      /** Мастера, которые умеют ВСЕ выбранные услуги */
      resourceIds: ordered
        .map((s) => new Set(s.resources.map((r) => r.resourceId)))
        .reduce((acc, set) => new Set([...acc].filter((id) => set.has(id)))),
    };
  }

  /** Свободные слоты на дату: [{ resourceId, slots: ISO[] }]. */
  async slots(
    tx: Tx,
    tenant: TenantInfo,
    p: { date: string; serviceIds: string[]; resourceId?: string | null; onlyPublic?: boolean; ignoreLead?: boolean },
  ) {
    const settings = readSettings(tenant.settings);
    const svc = await this.loadServices(tx, p.serviceIds, p.onlyPublic);
    const candidates = [...svc.resourceIds].filter((id) => !p.resourceId || id === p.resourceId);
    if (!candidates.length) return [];

    const today = DateTime.now().setZone(tenant.timezone).startOf('day');
    const day = DateTime.fromISO(p.date, { zone: tenant.timezone });
    if (!day.isValid || day < today || (p.onlyPublic && day > today.plus({ days: settings.maxDaysAhead }))) return [];

    const { from, to } = dayBounds(p.date, tenant.timezone);
    const [resources, bookings, timeOffs] = await Promise.all([
      tx.resource.findMany({ where: { id: { in: candidates }, deletedAt: null, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      tx.booking.findMany({
        where: { resourceId: { in: candidates }, status: { in: ACTIVE_STATUSES }, startsAt: { lt: to }, blockedUntil: { gt: from } },
        select: { resourceId: true, startsAt: true, blockedUntil: true },
      }),
      tx.timeOff.findMany({
        where: { resourceId: { in: candidates }, startsAt: { lt: to }, endsAt: { gt: from } },
        select: { resourceId: true, startsAt: true, endsAt: true },
      }),
    ]);
    const notBefore = Date.now() + (p.ignoreLead ? 0 : settings.minLeadMin * MIN);

    return resources.map((r) => {
      const busy: Interval[] = [
        ...bookings.filter((b) => b.resourceId === r.id).map((b) => ({ start: +b.startsAt, end: +b.blockedUntil })),
        ...timeOffs.filter((t) => t.resourceId === r.id).map((t) => ({ start: +t.startsAt, end: +t.endsAt })),
      ];
      const slots = computeSlots({
        date: p.date, tz: tenant.timezone, schedule: r.schedule as WeekSchedule, busy,
        durationMin: svc.duration, bufferMin: svc.buffer, stepMin: settings.slotStepMin, notBefore,
      });
      return { resourceId: r.id, name: r.name, slots: slots.map((s) => new Date(s).toISOString()) };
    });
  }

  async create(tx: Tx, tenant: TenantInfo, actor: Actor, input: CreateBookingInput) {
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, deletedAt: null } });
    if (!customer) throw notFound('Клиент');
    const svc = await this.loadServices(tx, input.serviceIds, input.source === 'WIDGET');

    let resourceId = input.resourceId;
    if (!resourceId) {
      // «Любой мастер»: первый, у кого этот слот свободен.
      const date = DateTime.fromJSDate(input.startsAt, { zone: tenant.timezone }).toISODate()!;
      const free = await this.slots(tx, tenant, { date, serviceIds: input.serviceIds, onlyPublic: input.source === 'WIDGET', ignoreLead: true });
      resourceId = free.find((r) => r.slots.includes(input.startsAt.toISOString()))?.resourceId ?? null;
      if (!resourceId) throw conflict('SLOT_TAKEN', 'Это время уже занято, выберите другое');
    }
    if (!svc.resourceIds.has(resourceId)) {
      throw new AppError('SERVICE_NOT_PROVIDED', 'Мастер не оказывает выбранные услуги', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const resource = await tx.resource.findFirst({ where: { id: resourceId, deletedAt: null, isActive: true } });
    if (!resource) throw notFound('Мастер');

    const startsAt = input.startsAt;
    const endsAt = new Date(+startsAt + svc.duration * MIN);
    const blockedUntil = new Date(+endsAt + svc.buffer * MIN);

    if (!input.allowOutsideSchedule) {
      if (!fitsSchedule(resource.schedule as WeekSchedule, tenant.timezone, startsAt, endsAt)) {
        throw new AppError('OUTSIDE_SCHEDULE', 'Время вне графика мастера', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      const off = await tx.timeOff.findFirst({ where: { resourceId, startsAt: { lt: blockedUntil }, endsAt: { gt: startsAt } } });
      if (off) throw new AppError('RESOURCE_UNAVAILABLE', 'Мастер в это время не работает', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    let booking: Booking;
    try {
      // Пересечение отсекает EXCLUDE-ограничение booking_no_overlap — атомарно, без гонок.
      // SAVEPOINT нужен, чтобы ошибка ограничения не «ломала» всю транзакцию.
      await tx.$executeRaw`SAVEPOINT booking_insert`;
      const id = randomUUID();
      booking = await tx.booking.create({
        data: {
          id,
          tenantId: tenant.id,
          customerId: customer.id,
          resourceId,
          startsAt,
          endsAt,
          blockedUntil,
          source: input.source,
          price: input.price ?? svc.price,
          notes: input.notes ?? null,
          referrer: input.referrer ?? null,
          // Ссылка «управлять записью» есть у каждой записи — её шлём в напоминаниях.
          manageTokenHash: manageTokenHash(id),
          createdById: actor.userId ?? null,
          items: {
            create: svc.services.map((s, i) => ({
              tenantId: tenant.id, serviceId: s.id, name: s.name, price: s.price, duration: s.duration, sortOrder: i,
            })),
          },
        },
      });
      await tx.$executeRaw`RELEASE SAVEPOINT booking_insert`;
    } catch (e) {
      if (isOverlapError(e)) throw conflict('SLOT_TAKEN', 'Это время уже занято, выберите другое');
      throw e;
    }

    await this.scheduleReminders(tx, tenant, booking, !!customer.telegramChatId);
    await audit(tx, actor, 'booking.create', 'Booking', booking.id, null, { startsAt, resourceId, source: input.source });
    return tx.booking.findUniqueOrThrow({ where: { id: booking.id }, include: bookingInclude });
  }

  /** Смена статуса с проверкой допустимых переходов и optimistic locking. */
  async transition(tx: Tx, actor: Actor, id: string, to: BookingStatus, version?: number) {
    const b = await tx.booking.findUnique({ where: { id } });
    if (!b) throw notFound('Запись');
    if (version !== undefined && b.version !== version) {
      throw conflict('BOOKING_VERSION_MISMATCH', 'Запись изменена другим пользователем, обновите экран');
    }
    if (b.status === to) return tx.booking.findUniqueOrThrow({ where: { id }, include: bookingInclude });
    if (!TRANSITIONS[b.status].includes(to)) {
      throw new AppError('INVALID_TRANSITION', `Нельзя перевести запись из ${b.status} в ${to}`, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    try {
      await tx.$executeRaw`SAVEPOINT booking_status`;
      const r = await tx.booking.updateMany({
        where: { id, version: b.version },
        data: { status: to, version: { increment: 1 }, cancelledAt: to === 'CANCELLED' ? new Date() : null },
      });
      if (!r.count) throw conflict('BOOKING_VERSION_MISMATCH', 'Запись изменена другим пользователем, обновите экран');
      await tx.$executeRaw`RELEASE SAVEPOINT booking_status`;
    } catch (e) {
      // Восстановление отменённой записи на уже занятое время.
      if (isOverlapError(e)) throw conflict('SLOT_TAKEN', 'Это время уже занято другой записью');
      throw e;
    }

    // Статистика клиента — при завершении визита (и откат, если завершение отменили).
    if (to === 'COMPLETED' || b.status === 'COMPLETED') {
      const sign = to === 'COMPLETED' ? 1 : -1;
      await tx.customer.update({
        where: { id: b.customerId },
        data: {
          totalVisits: { increment: sign },
          totalSpent: { increment: sign * b.price },
          ...(sign > 0 ? { lastVisitAt: b.startsAt } : {}),
        },
      });
    }
    // Склад: при завершении визита списываем материалы по нормам услуг, при откате — возвращаем
    if (to === 'COMPLETED') await consumeForBooking(tx, { tenantId: b.tenantId, userId: actor.userId }, id);
    else if (b.status === 'COMPLETED') await returnForBooking(tx, { tenantId: b.tenantId, userId: actor.userId }, id);
    // Оплата визита абонементом или с депозита (и возврат при откате)
    if (to === 'COMPLETED') await settleBooking(tx, { tenantId: b.tenantId, userId: actor.userId }, id);
    else if (b.status === 'COMPLETED') await unsettleBooking(tx, { tenantId: b.tenantId, userId: actor.userId }, id);
    // Через 2 часа после визита — просьба оценить (снимается, если завершение отменили)
    if (to === 'COMPLETED' || b.status === 'COMPLETED') await scheduleFeedback(tx, b, to === 'COMPLETED');
    if (to === 'CANCELLED' || to === 'NO_SHOW') {
      await tx.reminder.updateMany({ where: { bookingId: id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    }
    await audit(tx, actor, 'booking.status', 'Booking', id, { status: b.status }, { status: to });
    return tx.booking.findUniqueOrThrow({ where: { id }, include: bookingInclude });
  }

  /** Перенос (время/мастер/услуги/цена/комментарий) с optimistic locking. */
  async update(
    tx: Tx,
    tenant: TenantInfo,
    actor: Actor,
    id: string,
    dto: { version: number; startsAt?: Date; resourceId?: string; serviceIds?: string[]; price?: number; notes?: string | null; allowOutsideSchedule?: boolean },
  ) {
    const b = await tx.booking.findUnique({ where: { id }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
    if (!b) throw notFound('Запись');
    if (b.version !== dto.version) throw conflict('BOOKING_VERSION_MISMATCH', 'Запись изменена другим пользователем, обновите экран');
    if (['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(b.status) && (dto.startsAt || dto.resourceId || dto.serviceIds)) {
      throw new AppError('BOOKING_CLOSED', 'Завершённую или отменённую запись нельзя перенести', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const serviceIds = dto.serviceIds ?? b.items.map((i) => i.serviceId);
    const resourceId = dto.resourceId ?? b.resourceId;
    const startsAt = dto.startsAt ?? b.startsAt;
    const timeChanged = !!(dto.startsAt || dto.resourceId || dto.serviceIds);

    const data: Prisma.BookingUncheckedUpdateManyInput = { version: { increment: 1 } };
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.price !== undefined) data.price = dto.price;

    if (timeChanged) {
      const svc = await this.loadServices(tx, serviceIds);
      if (!svc.resourceIds.has(resourceId)) {
        throw new AppError('SERVICE_NOT_PROVIDED', 'Мастер не оказывает выбранные услуги', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      const resource = await tx.resource.findFirst({ where: { id: resourceId, deletedAt: null } });
      if (!resource) throw notFound('Мастер');
      const endsAt = new Date(+startsAt + svc.duration * MIN);
      if (!dto.allowOutsideSchedule && !fitsSchedule(resource.schedule as WeekSchedule, tenant.timezone, startsAt, endsAt)) {
        throw new AppError('OUTSIDE_SCHEDULE', 'Время вне графика мастера', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      Object.assign(data, { resourceId, startsAt, endsAt, blockedUntil: new Date(+endsAt + svc.buffer * MIN) });
      if (dto.serviceIds) {
        if (dto.price === undefined) data.price = svc.price;
        await tx.bookingItem.deleteMany({ where: { bookingId: id } });
        await tx.bookingItem.createMany({
          data: svc.services.map((s, i) => ({ tenantId: tenant.id, bookingId: id, serviceId: s.id, name: s.name, price: s.price, duration: s.duration, sortOrder: i })),
        });
      }
    }

    try {
      await tx.$executeRaw`SAVEPOINT booking_update`;
      const r = await tx.booking.updateMany({ where: { id, version: dto.version }, data });
      if (!r.count) throw conflict('BOOKING_VERSION_MISMATCH', 'Запись изменена другим пользователем, обновите экран');
      await tx.$executeRaw`RELEASE SAVEPOINT booking_update`;
    } catch (e) {
      if (isOverlapError(e)) throw conflict('SLOT_TAKEN', 'Это время уже занято, выберите другое');
      throw e;
    }

    const updated = await tx.booking.findUniqueOrThrow({ where: { id }, include: { customer: true } });
    if (timeChanged) {
      await tx.reminder.deleteMany({ where: { bookingId: id, status: 'PENDING' } });
      await this.scheduleReminders(tx, tenant, updated, !!updated.customer.telegramChatId);
    }
    await audit(tx, actor, 'booking.update', 'Booking', id, { startsAt: b.startsAt, resourceId: b.resourceId }, { startsAt, resourceId });
    return tx.booking.findUniqueOrThrow({ where: { id }, include: bookingInclude });
  }

  /** Напоминания за 24 ч и за 2 ч. Отправку выполняет воркер (см. docs/ROADMAP.md, этап 2). */
  private async scheduleReminders(tx: Tx, tenant: TenantInfo, b: Booking, hasTelegram: boolean) {
    if (!readSettings(tenant.settings).remindersEnabled) return;
    const now = Date.now();
    const plan = [
      { type: 'BEFORE_24H' as const, at: +b.startsAt - 24 * 60 * MIN },
      { type: 'BEFORE_2H' as const, at: +b.startsAt - 2 * 60 * MIN },
    ].filter((r) => r.at > now);
    if (!plan.length) return;
    await tx.reminder.createMany({
      data: plan.map((r) => ({
        tenantId: tenant.id, bookingId: b.id, type: r.type,
        channel: hasTelegram ? 'TELEGRAM' : 'EMAIL', scheduledAt: new Date(r.at),
      })),
      skipDuplicates: true,
    });
  }
}
