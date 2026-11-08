import { Controller, Get, Query } from '@nestjs/common';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { workIntervals, WeekSchedule } from '../bookings/slots';
import { Auth, AuthCtx, Can } from '../common/auth';
import { AppError } from '../common/errors';
import { Zod } from '../common/http';
import { PrismaService } from '../common/prisma.service';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const query = z.object({ from: isoDate.optional(), to: isoDate.optional() });

/** Откуда пришёл клиент: метка ?src= из ссылки или канал создания записи */
export const SOURCE_LABELS: Record<string, string> = {
  yandex: 'Яндекс Карты', '2gis': '2ГИС', vk: 'ВКонтакте', telegram: 'Telegram', max: 'MAX', instagram: 'Instagram',
  whatsapp: 'WhatsApp', avito: 'Авито', site: 'Сайт салона', qr: 'QR-код', widget: 'Онлайн-запись', manual: 'Администратор', app: 'Приложение',
};
const sourceKey = (b: { referrer: string | null; source: string }) =>
  b.referrer ?? ({ WIDGET: 'widget', MANUAL: 'manual', MOBILE: 'app', TELEGRAM: 'telegram' } as Record<string, string>)[b.source] ?? 'manual';

const ACTIVE = ['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'COMPLETED'];

/**
 * Кабинет владельца: выручка, загрузка мастеров, источники клиентов, популярные услуги.
 * Доступ — право analytics.view (владелец и управляющий по умолчанию).
 */
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly prisma: PrismaService) {}

  @Can('analytics.view')
  @Get('summary')
  summary(@Auth() a: AuthCtx, @Query(new Zod(query)) q: z.infer<typeof query>) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { timezone: true } });
      const tz = tenant.timezone;
      const today = DateTime.now().setZone(tz).startOf('day');
      const to = q.to ? DateTime.fromISO(q.to, { zone: tz }) : today;
      const from = q.from ? DateTime.fromISO(q.from, { zone: tz }) : to.minus({ days: 29 });
      const days = Math.round(to.diff(from, 'days').days) + 1;
      if (!from.isValid || !to.isValid || days < 1 || days > 366) throw new AppError('VALIDATION_ERROR', 'Период — от 1 до 366 дней');
      const start = from.startOf('day').toJSDate();
      const end = to.plus({ days: 1 }).startOf('day').toJSDate();
      const prevStart = from.minus({ days }).startOf('day').toJSDate();

      const [bookings, prev, resources, newCustomers] = await Promise.all([
        tx.booking.findMany({
          where: { startsAt: { gte: start, lt: end } },
          select: {
            status: true, source: true, referrer: true, price: true, resourceId: true, startsAt: true, endsAt: true,
            items: { select: { name: true, price: true } },
          },
        }),
        tx.booking.findMany({ where: { startsAt: { gte: prevStart, lt: start } }, select: { status: true, price: true } }),
        tx.resource.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true, color: true, schedule: true }, orderBy: { sortOrder: 'asc' } }),
        tx.customer.count({ where: { deletedAt: null, createdAt: { gte: start, lt: end } } }),
      ]);

      const active = bookings.filter((b) => ACTIVE.includes(b.status));
      const completed = bookings.filter((b) => b.status === 'COMPLETED');
      const sum = (list: { price: number }[]) => list.reduce((s, b) => s + b.price, 0);
      const online = active.filter((b) => b.source === 'WIDGET' || b.source === 'TELEGRAM').length;

      // По дням
      const byDayMap = new Map<string, { date: string; revenue: number; bookings: number }>();
      for (let i = 0; i < days; i++) {
        const d = from.plus({ days: i }).toISODate()!;
        byDayMap.set(d, { date: d, revenue: 0, bookings: 0 });
      }
      for (const b of active) {
        const d = byDayMap.get(DateTime.fromJSDate(b.startsAt).setZone(tz).toISODate()!);
        if (!d) continue;
        d.bookings += 1;
        d.revenue += b.price;
      }

      // Источники
      const src = new Map<string, { key: string; label: string; count: number; amount: number }>();
      for (const b of active) {
        const key = sourceKey(b);
        const s = src.get(key) ?? { key, label: SOURCE_LABELS[key] ?? key, count: 0, amount: 0 };
        s.count += 1;
        s.amount += b.price;
        src.set(key, s);
      }

      // Загрузка мастеров: занятые минуты / минуты по графику за период
      const masters = resources.map((r) => {
        let capacity = 0;
        for (let i = 0; i < days; i++) {
          for (const w of workIntervals(r.schedule as WeekSchedule, from.plus({ days: i }).toISODate()!, tz)) capacity += (w.end - w.start) / 60_000;
        }
        const mine = active.filter((b) => b.resourceId === r.id);
        const booked = mine.reduce((s, b) => s + (+b.endsAt - +b.startsAt) / 60_000, 0);
        return {
          id: r.id, name: r.name, color: r.color, bookings: mine.length, amount: sum(mine),
          bookedMin: Math.round(booked), capacityMin: Math.round(capacity), load: capacity ? Math.min(1, booked / capacity) : 0,
        };
      });

      // Услуги
      const svc = new Map<string, { name: string; count: number; amount: number }>();
      for (const b of active) for (const it of b.items) {
        const s = svc.get(it.name) ?? { name: it.name, count: 0, amount: 0 };
        s.count += 1;
        s.amount += it.price;
        svc.set(it.name, s);
      }

      const totalBookings = bookings.filter((b) => b.status !== 'CANCELLED').length;
      return {
        period: { from: from.toISODate(), to: to.toISODate(), days },
        totals: {
          revenue: sum(completed),
          booked: sum(active),
          bookings: active.length,
          completed: completed.length,
          cancelled: bookings.filter((b) => b.status === 'CANCELLED').length,
          noShow: bookings.filter((b) => b.status === 'NO_SHOW').length,
          noShowRate: totalBookings ? bookings.filter((b) => b.status === 'NO_SHOW').length / totalBookings : 0,
          avgCheck: active.length ? Math.round(sum(active) / active.length) : 0,
          onlineShare: active.length ? online / active.length : 0,
          newCustomers,
          load: masters.reduce((s, m) => s + m.capacityMin, 0) ? masters.reduce((s, m) => s + m.bookedMin, 0) / masters.reduce((s, m) => s + m.capacityMin, 0) : 0,
        },
        previous: {
          booked: sum(prev.filter((b) => ACTIVE.includes(b.status))),
          bookings: prev.filter((b) => ACTIVE.includes(b.status)).length,
        },
        byDay: [...byDayMap.values()],
        sources: [...src.values()].sort((x, y) => y.count - x.count),
        masters: masters.sort((x, y) => y.amount - x.amount),
        services: [...svc.values()].sort((x, y) => y.amount - x.amount).slice(0, 10),
      };
    });
  }

  /**
   * Три карточки «на сегодня» — первый экран владельца:
   * загрузка, ожидаемый доход, самый прибыльный мастер (за 7 дней). Внутри — детали для раскрытия.
   */
  @Can('analytics.view')
  @Get('today')
  today(@Auth() a: AuthCtx) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const { timezone: tz } = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { timezone: true } });
      const day = DateTime.now().setZone(tz).startOf('day');
      const date = day.toISODate()!;
      const start = day.toJSDate();
      const end = day.plus({ days: 1 }).toJSDate();
      const weekStart = day.minus({ days: 6 }).toJSDate();
      const [resources, todays, week] = await Promise.all([
        tx.resource.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true, color: true, schedule: true }, orderBy: { sortOrder: 'asc' } }),
        tx.booking.findMany({
          where: { startsAt: { gte: start, lt: end }, status: { in: ACTIVE as never } },
          orderBy: { startsAt: 'asc' },
          select: {
            id: true, startsAt: true, endsAt: true, price: true, status: true, resourceId: true,
            customer: { select: { name: true } }, items: { select: { name: true }, orderBy: { sortOrder: 'asc' } },
          },
        }),
        tx.booking.findMany({ where: { startsAt: { gte: weekStart, lt: end }, status: { in: ACTIVE as never } }, select: { resourceId: true, price: true, status: true } }),
      ]);
      const now = Date.now();
      const MIN = 60_000;

      const masters = resources.map((r) => {
        const work = workIntervals(r.schedule as WeekSchedule, date, tz);
        const mine = todays.filter((b) => b.resourceId === r.id);
        const capacity = work.reduce((s, w) => s + (w.end - w.start) / MIN, 0);
        const booked = mine.reduce((s, b) => s + (+b.endsAt - +b.startsAt) / MIN, 0);
        // Свободные окна от 30 минут, которые ещё не прошли — их можно «продать» сегодня
        const free: { from: string; to: string; minutes: number }[] = [];
        for (const w of work) {
          let cur = Math.max(w.start, now);
          for (const b of mine) {
            const bs = +b.startsAt, be = +b.endsAt;
            if (be <= cur || bs >= w.end) continue;
            if (bs - cur >= 30 * MIN) free.push(slot(cur, bs, tz));
            cur = Math.max(cur, be);
          }
          if (w.end - cur >= 30 * MIN) free.push(slot(cur, w.end, tz));
        }
        return { id: r.id, name: r.name, color: r.color, capacityMin: Math.round(capacity), bookedMin: Math.round(booked), load: capacity ? Math.min(1, booked / capacity) : 0, bookings: mine.length, free };
      });
      const capacityMin = masters.reduce((s, m) => s + m.capacityMin, 0);
      const bookedMin = masters.reduce((s, m) => s + m.bookedMin, 0);

      const byMaster = new Map<string, { amount: number; bookings: number }>();
      for (const b of week) {
        const m = byMaster.get(b.resourceId) ?? { amount: 0, bookings: 0 };
        m.amount += b.price;
        m.bookings += 1;
        byMaster.set(b.resourceId, m);
      }
      const weekTotal = week.reduce((s, b) => s + b.price, 0);
      const ranking = resources
        .map((r) => ({ id: r.id, name: r.name, color: r.color, ...(byMaster.get(r.id) ?? { amount: 0, bookings: 0 }) }))
        .map((r) => ({ ...r, share: weekTotal ? r.amount / weekTotal : 0, avgCheck: r.bookings ? Math.round(r.amount / r.bookings) : 0 }))
        .sort((x, y) => y.amount - x.amount);

      const names = new Map(resources.map((r) => [r.id, r.name]));
      return {
        date,
        load: { value: capacityMin ? bookedMin / capacityMin : 0, bookedMin, capacityMin, masters, freeMin: masters.reduce((s, m) => s + m.free.reduce((x, f) => x + f.minutes, 0), 0) },
        revenue: {
          expected: todays.reduce((s, b) => s + b.price, 0),
          done: todays.filter((b) => b.status === 'COMPLETED').reduce((s, b) => s + b.price, 0),
          bookings: todays.length,
          list: todays.map((b) => ({
            id: b.id, startsAt: b.startsAt, price: b.price, status: b.status, customer: b.customer.name,
            services: b.items.map((i) => i.name), master: names.get(b.resourceId) ?? '',
          })),
        },
        topMaster: { period: '7d', top: ranking[0] && ranking[0].amount > 0 ? ranking[0] : null, ranking },
      };
    });
  }
}

const slot = (from: number, to: number, tz: string) => ({
  from: DateTime.fromMillis(from).setZone(tz).toFormat('HH:mm'),
  to: DateTime.fromMillis(to).setZone(tz).toFormat('HH:mm'),
  minutes: Math.round((to - from) / 60_000),
});
