import { afterRating, attachComment, submitReview } from '../reviews/reviews';
import { Injectable } from '@nestjs/common';
import { env } from '../config';
import { BookingsService } from '../bookings/bookings.service';
import { sha256 } from '../common/crypto';
import { manageUrl } from '../common/manage-token';
import { PrismaService } from '../common/prisma.service';
import { readSettings } from '../common/tenant-settings';
import { bookingButtons, CUSTOMER_FIELD } from '../reminders/process';
import { telegramText } from '../reminders/messages';
import { Button, ChannelName, max } from './channels';
import { esc, notifyStaff } from './staff';

export const STATUS_TEXT: Record<string, string> = {
  SCHEDULED: 'ожидает подтверждения', CONFIRMED: '✅ подтверждена', ARRIVED: 'вы в салоне',
  COMPLETED: 'визит завершён', CANCELLED: '❌ отменена', NO_SHOW: 'неявка',
};
const CHANNEL_NAME: Record<ChannelName, string> = { TELEGRAM: 'Telegram', MAX: 'MAX', VK: 'ВКонтакте', EMAIL: 'email' };

export type BotReply = { text: string; buttons?: Button[][]; /** ссылка на запись в салон (для кнопки меню Telegram) */ bookingUrl?: string };

/**
 * Общая логика клиентских ботов (Telegram, MAX, ВКонтакте):
 * привязка клиента по ссылке после записи и кнопки «Подтвердить»/«Отменить».
 */
@Injectable()
export class ClientBotService {
  constructor(private readonly prisma: PrismaService, private readonly bookings: BookingsService) {}

  /** Клиент перешёл по ссылке «Получать напоминания» (payload b_<токен записи>). */
  async linkCustomer(channel: ChannelName, externalId: string, payload: string): Promise<BotReply> {
    const db = this.prisma.system;
    // s_<адрес салона> — запись в салон прямо из мессенджера (ссылку салон ставит в свой канал, группу, Карты)
    if (payload.startsWith('s_')) return this.salonEntry(channel, payload.slice(2));
    if (!payload.startsWith('b_')) return this.upcoming(channel, externalId);
    const b = await db.booking.findUnique({
      where: { manageTokenHash: sha256(payload.slice(2)) },
      include: { customer: true, resource: { select: { name: true } }, items: { select: { name: true }, orderBy: { sortOrder: 'asc' } } },
    });
    if (!b) return { text: 'Запись не найдена. Возможно, ссылка устарела.' };
    await db.customer.update({ where: { id: b.customerId }, data: { [CUSTOMER_FIELD[channel]]: externalId } });
    const t = await db.tenant.findUniqueOrThrow({ where: { id: b.tenantId } });
    const url = manageUrl(t.slug, b.id);
    const body = telegramText({
      type: 'BEFORE_24H', startsAt: b.startsAt, tz: t.timezone, url, salon: { name: t.name, address: t.address, phone: t.phone },
      services: b.items.map((i) => i.name), master: b.resource.name, customerName: b.customer.name,
    }).replace(/^<b>Пора к мастеру:/, '<b>Вы записаны:');
    return {
      text: `${body}\n\nГотово! Напомним о визите за сутки и за 2 часа. Отменить или подтвердить можно кнопками ниже.`,
      buttons: ['SCHEDULED', 'CONFIRMED'].includes(b.status) ? bookingButtons(b.id, b.status, url) : undefined,
    };
  }

  private async salonEntry(channel: ChannelName, slug: string): Promise<BotReply> {
    if (!/^[a-z0-9-]{3,32}$/.test(slug)) return { text: 'Салон не найден. Проверьте ссылку.' };
    const t = await this.prisma.system.tenant.findFirst({ where: { slug, deletedAt: null } });
    if (!t || !readSettings(t.settings).onlineBookingEnabled) return { text: 'Онлайн-запись в этот салон сейчас недоступна.' };
    // MAX с подключённым мини-приложением — запись открывается внутри MAX и напоминания подключаются сами
    const mini = channel === 'MAX' ? max.miniAppLink(t.slug) : null;
    const url = mini ?? `${env.PUBLIC_WEB_URL}/b/${t.slug}?src=${channel.toLowerCase()}`;
    const lines = [`<b>${esc(t.name)}</b>`, t.address ? `📍 ${esc(t.address)}` : '', '', 'Выберите услугу, мастера и удобное время — запись займёт минуту. Напоминание о визите придёт сюда же.'];
    return {
      text: lines.filter((l, i) => l || i === 2).join('\n'),
      buttons: [[{ text: '📅 Записаться онлайн', url, webApp: true }]],
      bookingUrl: channel === 'TELEGRAM' ? url : undefined,
    };
  }

  /**
   * Клиент написал боту без ссылки: показываем ближайшие записи (до 3) с кнопками,
   * а если записей нет — что умеет бот.
   */
  private async upcoming(channel: ChannelName, externalId: string): Promise<BotReply> {
    const field = CUSTOMER_FIELD[channel];
    const db = this.prisma.system;
    const rows = externalId
      ? await db.booking.findMany({
          where: { customer: { [field]: externalId, deletedAt: null }, status: { in: ['SCHEDULED', 'CONFIRMED'] }, startsAt: { gt: new Date() } },
          include: { resource: { select: { name: true } }, items: { select: { name: true }, orderBy: { sortOrder: 'asc' } } },
          orderBy: { startsAt: 'asc' }, take: 3,
        })
      : [];
    const tenants = new Map((await db.tenant.findMany({ where: { id: { in: [...new Set(rows.map((b) => b.tenantId))] }, deletedAt: null }, select: { id: true, name: true, slug: true, timezone: true, address: true } })).map((x) => [x.id, x]));
    const list = rows.flatMap((b) => { const tenant = tenants.get(b.tenantId); return tenant ? [{ ...b, tenant }] : []; });
    if (!list.length) {
      return { text: 'Здравствуйте! Это MioFlow — онлайн-запись к мастеру и напоминания о визите.\n\nЧтобы записаться, откройте ссылку на запись от вашего салона. После записи напоминания будут приходить сюда.' };
    }
    const lines = list.map((b) => {
      const when = new Date(b.startsAt).toLocaleString('ru-RU', { timeZone: b.tenant.timezone, weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
      return `📅 <b>${esc(when)}</b>\n${esc(b.tenant.name)}${b.tenant.address ? `, ${esc(b.tenant.address)}` : ''}\n${esc(b.items.map((i) => i.name).join(', '))} · ${esc(b.resource.name)} · ${STATUS_TEXT[b.status]}`;
    });
    const buttons: Button[][] = list.map((b, i) => [{ text: `${list.length > 1 ? `${i + 1}. ` : ''}Перенести или отменить`, url: manageUrl(b.tenant.slug, b.id) }]);
    const again = list[0].tenant.slug;
    buttons.push([{ text: '➕ Записаться ещё', url: (channel === 'MAX' ? max.miniAppLink(again) : null) ?? `${env.PUBLIC_WEB_URL}/b/${again}?src=${channel.toLowerCase()}`, webApp: true }]);
    return { text: `<b>Ваши записи</b>\n\n${lines.join('\n\n')}`, buttons };
  }

  /** Оценка визита кнопкой «1⭐…5⭐»: data = r:<оценка>:<id записи> */
  private async rate(channel: ChannelName, externalId: string, data: string): Promise<{ note: string; reply?: BotReply }> {
    const [, n, bookingId] = data.split(':');
    const rating = Number(n);
    if (!/^[0-9a-f-]{36}$/.test(bookingId ?? '') || !(rating >= 1 && rating <= 5)) return { note: '' };
    const field = CUSTOMER_FIELD[channel];
    const b = await this.prisma.system.booking.findFirst({ where: { id: bookingId, customer: { [field]: externalId } }, select: { id: true } });
    if (!b) return { note: 'Запись не найдена' };
    const r = await submitReview(this.prisma.system, { bookingId: b.id, rating, source: channel });
    if (!r.ok) return { note: r.error };
    const reply = await afterRating(this.prisma.system, r.review, r.prev?.rating !== rating);
    return { note: `Спасибо! Ваша оценка: ${rating}⭐`, reply };
  }

  /**
   * Обычное сообщение клиента (не команда и не кнопка). Если недавно он поставил оценку без комментария —
   * это комментарий к ней. Иначе — подсказка, что умеет бот.
   */
  async message(channel: ChannelName, externalId: string, text: string): Promise<BotReply> {
    const field = CUSTOMER_FIELD[channel];
    const customers = await this.prisma.system.customer.findMany({ where: { [field]: externalId, deletedAt: null }, select: { id: true } });
    const r = await attachComment(this.prisma.system, customers.map((c) => c.id), text);
    if (r) return { text: r.rating <= 3 ? 'Спасибо, передали владельцу салона. С вами свяжутся.' : 'Спасибо за тёплые слова! Передали мастеру.' };
    return this.linkCustomer(channel, externalId, '');
  }

  /**
   * Нажатие кнопки под напоминанием: data = «c:<id>» (подтвердить) или «x:<id>» (отменить).
   * Управлять записью может только тот, кто привязан к клиенту этой записи в этом канале.
   */
  async action(channel: ChannelName, externalId: string, data: string): Promise<{ note: string; reply?: BotReply }> {
    if ((data ?? '').startsWith('r:')) return this.rate(channel, externalId, data);
    const [act, bookingId] = (data ?? '').split(':');
    if (!bookingId || !['c', 'x'].includes(act) || !/^[0-9a-f-]{36}$/.test(bookingId)) return { note: '' };
    const field = CUSTOMER_FIELD[channel];
    const b = await this.prisma.system.booking.findFirst({ where: { id: bookingId, customer: { [field]: externalId } } });
    if (!b) return { note: 'Запись не найдена' };
    const t = await this.prisma.system.tenant.findUniqueOrThrow({ where: { id: b.tenantId } });
    const s = readSettings(t.settings);

    let note: string;
    if (!['SCHEDULED', 'CONFIRMED'].includes(b.status)) note = `Запись ${STATUS_TEXT[b.status]}`;
    else if (act === 'c') {
      if (b.status === 'SCHEDULED') await this.prisma.withTenant(t.id, (tx) => this.bookings.transition(tx, { tenantId: t.id }, b.id, 'CONFIRMED'));
      note = 'Спасибо! Визит подтверждён ✅';
    } else if (+b.startsAt - Date.now() <= s.cancelBeforeHours * 3600_000) {
      note = `Отменить онлайн можно не позднее чем за ${s.cancelBeforeHours} ч. Позвоните в салон${t.phone ? `: ${t.phone}` : ''}`;
    } else {
      await this.prisma.withTenant(t.id, (tx) => this.bookings.transition(tx, { tenantId: t.id }, b.id, 'CANCELLED'));
      note = 'Запись отменена';
      const when = new Date(b.startsAt).toLocaleString('ru-RU', { timeZone: t.timezone, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
      void notifyStaff(this.prisma.system, t.id, `❌ Клиент отменил запись через ${CHANNEL_NAME[channel]}: ${esc(when)}`, {
        resourceId: b.resourceId, push: { title: 'Клиент отменил запись', body: when, data: { bookingId: b.id } },
      });
    }
    const fresh = await this.prisma.system.booking.findUniqueOrThrow({ where: { id: b.id } });
    const url = manageUrl(t.slug, b.id);
    const active = ['SCHEDULED', 'CONFIRMED'].includes(fresh.status);
    return {
      note,
      reply: { text: `${note}\n\nСтатус записи: ${STATUS_TEXT[fresh.status]}`, buttons: active ? bookingButtons(b.id, fresh.status, url) : [[{ text: 'Открыть запись', url }]] },
    };
  }
}
