import { Body, Controller, Delete, Headers, HttpCode, Post } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { BookingsService } from '../bookings/bookings.service';
import { Auth, AuthCtx, Public } from '../common/auth';
import { randomToken, sha256 } from '../common/crypto';
import { AppError } from '../common/errors';
import { manageUrl } from '../common/manage-token';
import { PrismaService } from '../common/prisma.service';
import { readSettings } from '../common/tenant-settings';
import { env } from '../config';
import { bookingButtons } from '../reminders/process';
import { telegramText } from '../reminders/messages';
import { esc, telegram } from './telegram';

type TgUpdate = {
  update_id: number;
  message?: { chat: { id: number }; text?: string; from?: { first_name?: string } };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } };
};

const STATUS_TEXT: Record<string, string> = {
  SCHEDULED: 'ожидает подтверждения', CONFIRMED: '✅ подтверждена', ARRIVED: 'вы в салоне',
  COMPLETED: 'визит завершён', CANCELLED: '❌ отменена', NO_SHOW: 'неявка',
};

@Controller()
export class BotController {
  constructor(private readonly prisma: PrismaService, private readonly bookings: BookingsService) {}

  /** Вебхук Telegram. Проверяется секрет из заголовка, заданный при setWebhook. */
  @Public()
  @HttpCode(200)
  @Post('webhooks/telegram')
  async webhook(@Headers('x-telegram-bot-api-secret-token') secret: string | undefined, @Body() update: TgUpdate) {
    const expected = env.TELEGRAM_WEBHOOK_SECRET;
    if (!expected || !secret || secret.length !== expected.length || !timingSafeEqual(Buffer.from(secret), Buffer.from(expected))) {
      throw new AppError('FORBIDDEN', 'bad secret', 403);
    }
    try {
      if (update.callback_query) await this.onCallback(update.callback_query);
      else if (update.message?.text) await this.onMessage(String(update.message.chat.id), update.message.text.trim());
    } catch {
      // Telegram повторяет доставку при не-200 — ошибки обработки не должны вызывать бесконечные ретраи.
    }
    return { ok: true };
  }

  // ─── Привязка Telegram сотрудника (уведомления о новых записях и об оплате) ───
  @Post('me/telegram')
  async linkStaff(@Auth() a: AuthCtx) {
    if (!telegram.enabled || !env.TELEGRAM_BOT_USERNAME) throw new AppError('TELEGRAM_DISABLED', 'Telegram-бот ещё не настроен', 503);
    const token = randomToken(18);
    await this.prisma.system.user.update({
      where: { id: a.userId },
      data: { telegramLinkHash: sha256(token), telegramLinkExpires: new Date(Date.now() + 15 * 60_000) },
    });
    return { url: telegram.deepLink(`u_${token}`) };
  }

  @Delete('me/telegram')
  async unlinkStaff(@Auth() a: AuthCtx) {
    await this.prisma.system.user.update({ where: { id: a.userId }, data: { telegramChatId: null } });
    return { ok: true };
  }

  private async onMessage(chatId: string, text: string) {
    const db = this.prisma.system;
    const payload = text.startsWith('/start') ? text.slice(6).trim() : '';

    if (payload.startsWith('u_')) {
      const user = await db.user.findUnique({ where: { telegramLinkHash: sha256(payload.slice(2)) } });
      if (!user || !user.telegramLinkExpires || user.telegramLinkExpires < new Date()) {
        await telegram.send(chatId, 'Ссылка устарела. Получите новую в приложении: «Ещё» → «Уведомления в Telegram».');
        return;
      }
      await db.user.update({ where: { id: user.id }, data: { telegramChatId: chatId, telegramLinkHash: null, telegramLinkExpires: null } });
      await telegram.send(chatId, `Готово, ${esc(user.name)}! Сюда будут приходить новые онлайн-записи и напоминания об оплате.`);
      return;
    }

    if (payload.startsWith('b_')) {
      const b = await db.booking.findUnique({
        where: { manageTokenHash: sha256(payload.slice(2)) },
        include: { customer: true, resource: { select: { name: true } }, items: { select: { name: true }, orderBy: { sortOrder: 'asc' } } },
      });
      if (!b) {
        await telegram.send(chatId, 'Запись не найдена. Возможно, ссылка устарела.');
        return;
      }
      await db.customer.update({ where: { id: b.customerId }, data: { telegramChatId: chatId } });
      const t = await db.tenant.findUniqueOrThrow({ where: { id: b.tenantId } });
      const url = manageUrl(t.slug, b.id);
      const body = telegramText({
        type: 'BEFORE_24H', startsAt: b.startsAt, tz: t.timezone, url, salon: { name: t.name, address: t.address, phone: t.phone },
        services: b.items.map((i) => i.name), master: b.resource.name, customerName: b.customer.name,
      }).replace(/^<b>Пора к мастеру:/, '<b>Вы записаны:');
      await telegram.send(
        chatId,
        `${body}\n\nГотово! Напомним о визите за сутки и за 2 часа. Отменить или подтвердить можно кнопками ниже.`,
        ['SCHEDULED', 'CONFIRMED'].includes(b.status) ? bookingButtons(b.id, b.status, url) : undefined,
      );
      return;
    }

    await telegram.send(chatId, 'Здравствуйте! Это MioFlow — напоминания о записи к мастеру. Чтобы подключить их, нажмите «Подключить Telegram» после записи на сайте салона.');
  }

  private async onCallback(q: NonNullable<TgUpdate['callback_query']>) {
    const chatId = q.message ? String(q.message.chat.id) : null;
    const [action, bookingId] = (q.data ?? '').split(':');
    if (!chatId || !bookingId || !['c', 'x'].includes(action)) return telegram.answerCallback(q.id);

    // Управлять записью может только тот чат, который привязан к клиенту этой записи.
    const b = await this.prisma.system.booking.findFirst({ where: { id: bookingId, customer: { telegramChatId: chatId } } });
    if (!b) return telegram.answerCallback(q.id, 'Запись не найдена');
    const t = await this.prisma.system.tenant.findUniqueOrThrow({ where: { id: b.tenantId } });
    const s = readSettings(t.settings);

    let note: string;
    if (!['SCHEDULED', 'CONFIRMED'].includes(b.status)) note = `Запись ${STATUS_TEXT[b.status]}`;
    else if (action === 'c') {
      if (b.status === 'SCHEDULED') await this.prisma.withTenant(t.id, (tx) => this.bookings.transition(tx, { tenantId: t.id }, b.id, 'CONFIRMED'));
      note = 'Спасибо! Визит подтверждён ✅';
    } else if (+b.startsAt - Date.now() <= s.cancelBeforeHours * 3600_000) {
      note = `Отменить онлайн можно не позднее чем за ${s.cancelBeforeHours} ч. Позвоните в салон${t.phone ? `: ${t.phone}` : ''}`;
    } else {
      await this.prisma.withTenant(t.id, (tx) => this.bookings.transition(tx, { tenantId: t.id }, b.id, 'CANCELLED'));
      note = 'Запись отменена';
      const { notifyStaff } = await import('./staff');
      const when = new Date(b.startsAt).toLocaleString('ru-RU', { timeZone: t.timezone, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
      void notifyStaff(this.prisma.system, t.id, `❌ Клиент отменил запись через Telegram: ${esc(when)}`, {
        resourceId: b.resourceId, push: { title: 'Клиент отменил запись', body: when, data: { bookingId: b.id } },
      });
    }
    await telegram.answerCallback(q.id, note);
    if (q.message) {
      const fresh = await this.prisma.system.booking.findUniqueOrThrow({ where: { id: b.id } });
      const url = manageUrl(t.slug, b.id);
      const active = ['SCHEDULED', 'CONFIRMED'].includes(fresh.status);
      await telegram.editText(chatId, q.message.message_id, `${note}\n\nСтатус записи: ${STATUS_TEXT[fresh.status]}`, active ? bookingButtons(b.id, fresh.status, url) : [[{ text: 'Открыть запись', url }]]);
    }
  }
}
