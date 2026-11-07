import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { bookingInclude, BookingsService } from '../bookings/bookings.service';
import { Public } from '../common/auth';
import { audit } from '../common/audit';
import { sha256 } from '../common/crypto';
import { manageToken, manageUrl } from '../common/manage-token';
import { notifyStaff } from '../notify/staff';
import { max, vk } from '../notify/channels';
import { esc, telegram } from '../notify/telegram';
import { CONSENT_VERSION } from '../common/legal';
import { AppError, notFound } from '../common/errors';
import { Zod } from '../common/http';
import { PrismaService } from '../common/prisma.service';
import { phone, uuid } from '../common/schemas';
import { readSettings } from '../common/tenant-settings';

/** Сколько будущих онлайн-записей может быть у одного номера в одном салоне */
const MAX_ONLINE_BOOKINGS_PER_PHONE = 3;

const slotsQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  serviceIds: z.string().transform((s) => s.split(',').filter(Boolean)).pipe(z.array(uuid).min(1).max(5)),
  resourceId: uuid.optional(),
});
const bookSchema = z.object({
  serviceIds: z.array(uuid).min(1).max(5),
  resourceId: uuid.nullable(),
  startsAt: z.coerce.date(),
  name: z.string().trim().min(1).max(100),
  phone,
  comment: z.string().trim().max(500).optional(),
  /** Согласие на обработку ПДн — обязательно */
  consent: z.literal(true, { error: 'Необходимо согласие на обработку персональных данных' }),
  marketingConsent: z.boolean().optional(),
  /** honeypot */
  website: z.string().max(0).optional(),
  /** Email для напоминаний (необязательно) — если клиент не пользуется мессенджерами */
  email: z.string().trim().toLowerCase().email('Некорректный email').max(200).optional().or(z.literal('').transform(() => undefined)),
  /** Откуда пришёл клиент: yandex_maps, 2gis, vk, instagram, site, qr… (из ссылки ?src=) */
  ref: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,32}$/).optional().or(z.literal('').transform(() => undefined)),
});

/**
 * Публичная онлайн-запись: /v1/public/:slug/...
 * Тенант определяется по slug, дальше все запросы идут через RLS (withTenant).
 */
@Public()
@Controller('public/:slug')
export class PublicController {
  constructor(private readonly prisma: PrismaService, private readonly bookings: BookingsService) {}

  private async tenant(slug: string) {
    const t = await this.prisma.app.tenant.findFirst({ where: { slug: slug.toLowerCase(), deletedAt: null } });
    if (!t) throw notFound('Салон');
    const s = readSettings(t.settings);
    // Subscription под RLS — читаем в контексте тенанта.
    const sub = await this.prisma.withTenant(t.id, (tx) =>
      tx.subscription.findUnique({ where: { tenantId: t.id }, select: { status: true } }),
    );
    const subscriptionOk = !!sub && ['TRIAL', 'ACTIVE', 'PAST_DUE'].includes(sub.status);
    return { ...t, s, available: s.onlineBookingEnabled && !!subscriptionOk };
  }

  @Get()
  async salon(@Param('slug') slug: string) {
    const t = await this.tenant(slug);
    return {
      name: t.name, slug: t.slug, phone: t.phone, address: t.address, timezone: t.timezone,
      available: t.available, maxDaysAhead: t.s.maxDaysAhead,
      /** Реквизиты салона как оператора ПДн — для страницы согласия */
      legalName: t.s.legalName ?? null, inn: t.s.inn ?? null,
      telegramBot: telegram.enabled ? telegram.deepLink('')?.replace(/\?start=$/, '') ?? null : null,
    };
  }

  @Get('services')
  async services(@Param('slug') slug: string) {
    const t = await this.tenant(slug);
    return this.prisma.withTenant(t.id, async (tx) => {
      const [categories, services] = await Promise.all([
        tx.serviceCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true } }),
        tx.service.findMany({
          where: { deletedAt: null, isActive: true, isPublic: true, resources: { some: { resource: { isActive: true, deletedAt: null } } } },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { id: true, name: true, description: true, price: true, duration: true, categoryId: true },
        }),
      ]);
      return { categories, services };
    });
  }

  @Get('resources')
  async resources(@Param('slug') slug: string, @Query('serviceIds') serviceIds?: string) {
    const t = await this.tenant(slug);
    const ids = (serviceIds ?? '').split(',').filter((x) => uuid.safeParse(x).success);
    return this.prisma.withTenant(t.id, (tx) =>
      tx.resource.findMany({
        where: {
          deletedAt: null, isActive: true,
          ...(ids.length ? { AND: ids.map((serviceId) => ({ services: { some: { serviceId } } })) } : {}),
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, position: true },
      }),
    );
  }

  @Get('slots')
  async slots(@Param('slug') slug: string, @Query(new Zod(slotsQuery)) q: z.infer<typeof slotsQuery>) {
    const t = await this.tenant(slug);
    if (!t.available) return [];
    return this.prisma.withTenant(t.id, (tx) => this.bookings.slots(tx, t, { ...q, onlyPublic: true }));
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('book')
  async book(@Param('slug') slug: string, @Body(new Zod(bookSchema)) dto: z.infer<typeof bookSchema>, @Req() req: Request) {
    const t = await this.tenant(slug);
    if (!t.available) throw new AppError('BOOKING_UNAVAILABLE', 'Онлайн-запись в этот салон сейчас недоступна', 403);

    // Клиент может записаться только в реально свободный слот (с учётом minLeadMin).
    const date = DateTime.fromJSDate(dto.startsAt, { zone: t.timezone }).toISODate()!;

    const booking = await this.prisma.withTenant(t.id, async (tx) => {
      const free = await this.bookings.slots(tx, t, { date, serviceIds: dto.serviceIds, resourceId: dto.resourceId, onlyPublic: true });
      const iso = dto.startsAt.toISOString();
      const resource = free.find((r) => r.slots.includes(iso));
      if (!resource) throw new AppError('SLOT_TAKEN', 'Это время уже занято, выберите другое', 409);

      let customer = await tx.customer.findFirst({ where: { phone: dto.phone, deletedAt: null } });
      // Защита от спама и накрутки: не больше N будущих онлайн-записей на один номер.
      if (customer) {
        const upcoming = await tx.booking.count({
          where: { customerId: customer.id, source: 'WIDGET', status: { in: ['SCHEDULED', 'CONFIRMED'] }, startsAt: { gt: new Date() } },
        });
        if (upcoming >= MAX_ONLINE_BOOKINGS_PER_PHONE) {
          throw new AppError('TOO_MANY_BOOKINGS', 'У вас уже есть несколько предстоящих записей. Чтобы записаться ещё, позвоните в салон', 429);
        }
      }
      if (!customer) {
        customer = await tx.customer.create({
          data: { tenantId: t.id, name: dto.name, phone: dto.phone, email: dto.email, source: 'WIDGET', marketingConsent: !!dto.marketingConsent },
        });
      } else if ((dto.marketingConsent && !customer.marketingConsent) || (dto.email && !customer.email)) {
        await tx.customer.update({
          where: { id: customer.id },
          data: { ...(dto.marketingConsent ? { marketingConsent: true } : {}), ...(dto.email && !customer.email ? { email: dto.email } : {}) },
        });
      }
      const created = await this.bookings.create(tx, t, { tenantId: t.id }, {
        customerId: customer.id,
        resourceId: resource.resourceId,
        serviceIds: dto.serviceIds,
        startsAt: dto.startsAt,
        notes: dto.comment,
        source: 'WIDGET',
        referrer: dto.ref,
      });
      // Факт согласия на обработку ПДн (152-ФЗ): версия текста, IP, время.
      await tx.auditLog.create({
        data: {
          tenantId: t.id, action: 'consent.booking', entityType: 'Customer', entityId: customer.id,
          after: { version: CONSENT_VERSION, bookingId: created.id, userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200) }, ip: req.ip,
        },
      });
      return created;
    });

    const token = manageToken(booking.id);
    const when = new Date(booking.startsAt).toLocaleString('ru-RU', { timeZone: t.timezone, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    void notifyStaff(
      this.prisma.system, t.id,
      `🆕 <b>Онлайн-запись</b>\n${esc(when)} · ${esc(booking.resource.name)}\n${esc(booking.items.map((i) => i.name).join(', '))}\n${esc(dto.name)}, ${esc(dto.phone)}`,
      { resourceId: booking.resourceId, push: { title: 'Новая онлайн-запись', body: `${when} · ${dto.name} · ${booking.items.map((i) => i.name).join(', ')}`, data: { bookingId: booking.id } } },
    );

    return {
      id: booking.id,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      price: booking.price,
      resource: booking.resource.name,
      services: booking.items.map((i) => i.name),
      /** Ссылка «управлять записью» (отмена), её же шлём в напоминаниях */
      manageUrl: manageUrl(t.slug, booking.id),
      manageToken: token,
      /** Кнопка «Получать напоминания в Telegram» */
      telegramUrl: telegram.enabled ? telegram.deepLink(`b_${token}`) : null,
      /** Кнопки «Получать напоминания в …» — только для подключённых у нас мессенджеров */
      messengers: messengerLinks(token),
    };
  }

  @Get('manage/:token')
  async manage(@Param('slug') slug: string, @Param('token') token: string) {
    const t = await this.tenant(slug);
    const b = await this.prisma.withTenant(t.id, (tx) =>
      tx.booking.findUnique({ where: { manageTokenHash: sha256(token) }, include: bookingInclude }),
    );
    if (!b) throw notFound('Запись');
    return {
      id: b.id, status: b.status, startsAt: b.startsAt, endsAt: b.endsAt, price: b.price,
      resource: b.resource.name, services: b.items.map((i) => i.name),
      salon: { name: t.name, phone: t.phone, address: t.address },
      canCancel: this.canCancel(b.status, b.startsAt, t.s.cancelBeforeHours),
      cancelBeforeHours: t.s.cancelBeforeHours,
      telegramUrl: telegram.enabled ? telegram.deepLink(`b_${token}`) : null,
      messengers: messengerLinks(token),
    };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('manage/:token/confirm')
  async confirm(@Param('slug') slug: string, @Param('token') token: string) {
    return this.act(slug, token, 'CONFIRMED');
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('manage/:token/cancel')
  async cancel(@Param('slug') slug: string, @Param('token') token: string) {
    return this.act(slug, token, 'CANCELLED');
  }

  private async act(slug: string, token: string, to: 'CONFIRMED' | 'CANCELLED') {
    const t = await this.tenant(slug);
    return this.prisma.withTenant(t.id, async (tx) => {
      const b = await tx.booking.findUnique({ where: { manageTokenHash: sha256(token) } });
      if (!b) throw notFound('Запись');
      if (to === 'CANCELLED' && !this.canCancel(b.status, b.startsAt, t.s.cancelBeforeHours)) {
        throw new AppError('CANCEL_TOO_LATE', `Отменить онлайн можно не позднее чем за ${t.s.cancelBeforeHours} ч. Позвоните в салон`, 422);
      }
      if (to === 'CONFIRMED' && b.status !== 'SCHEDULED') return { status: b.status };
      const r = await this.bookings.transition(tx, { tenantId: t.id }, b.id, to);
      await audit(tx, { tenantId: t.id }, `booking.client_${to.toLowerCase()}`, 'Booking', b.id);
      if (to === 'CANCELLED') {
        const when = new Date(b.startsAt).toLocaleString('ru-RU', { timeZone: t.timezone, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
        void notifyStaff(this.prisma.system, t.id, `❌ Клиент отменил запись: ${esc(when)}`, { resourceId: b.resourceId, push: { title: 'Клиент отменил запись', body: when, data: { bookingId: b.id } } });
      }
      return { status: r.status };
    });
  }

  private canCancel(status: string, startsAt: Date, hours: number) {
    return ['SCHEDULED', 'CONFIRMED'].includes(status) && +startsAt - Date.now() > hours * 3600_000;
  }
}

/** Ссылки привязки мессенджеров к записи (токен записи передаётся боту и связывает клиента). */
function messengerLinks(token: string) {
  return {
    telegram: telegram.enabled ? telegram.deepLink(`b_${token}`) : null,
    max: max.enabled ? max.deepLink(`b_${token}`) : null,
    vk: vk.enabled ? vk.deepLink(`b_${token}`) : null,
  };
}
