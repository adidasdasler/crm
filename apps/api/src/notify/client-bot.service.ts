import { Injectable } from '@nestjs/common';
import { BookingsService } from '../bookings/bookings.service';
import { sha256 } from '../common/crypto';
import { manageUrl } from '../common/manage-token';
import { PrismaService } from '../common/prisma.service';
import { readSettings } from '../common/tenant-settings';
import { bookingButtons, CUSTOMER_FIELD } from '../reminders/process';
import { telegramText } from '../reminders/messages';
import { Button, ChannelName } from './channels';
import { esc, notifyStaff } from './staff';

export const STATUS_TEXT: Record<string, string> = {
  SCHEDULED: 'ожидает подтверждения', CONFIRMED: '✅ подтверждена', ARRIVED: 'вы в салоне',
  COMPLETED: 'визит завершён', CANCELLED: '❌ отменена', NO_SHOW: 'неявка',
};
const CHANNEL_NAME: Record<ChannelName, string> = { TELEGRAM: 'Telegram', MAX: 'MAX', VK: 'ВКонтакте', EMAIL: 'email' };

export type BotReply = { text: string; buttons?: Button[][] };

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
    if (!payload.startsWith('b_')) {
      return { text: 'Здравствуйте! Это MioFlow — напоминания о записи к мастеру. Чтобы подключить их, нажмите кнопку мессенджера после онлайн-записи.' };
    }
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

  /**
   * Нажатие кнопки под напоминанием: data = «c:<id>» (подтвердить) или «x:<id>» (отменить).
   * Управлять записью может только тот, кто привязан к клиенту этой записи в этом канале.
   */
  async action(channel: ChannelName, externalId: string, data: string): Promise<{ note: string; reply?: BotReply }> {
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
