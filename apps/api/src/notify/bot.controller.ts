import { Body, Controller, Delete, Headers, HttpCode, Post } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Auth, AuthCtx, Public, NoDemo } from '../common/auth';
import { randomToken, sha256 } from '../common/crypto';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { env } from '../config';
import { max, toTelegramButtons } from './channels';
import { ClientBotService } from './client-bot.service';
import { esc, telegram } from './telegram';

type TgUpdate = {
  update_id: number;
  message?: { chat: { id: number }; text?: string; from?: { first_name?: string } };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } };
};

@Controller()
export class BotController {
  constructor(private readonly prisma: PrismaService, private readonly clientBot: ClientBotService) {}

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
  @NoDemo()
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

  // ─── Привязка MAX сотрудника: ссылка max.ru/<бот>?start=u_<токен>, обработка — в MessengersController ───
  @NoDemo()
  @Post('me/max')
  async linkStaffMax(@Auth() a: AuthCtx) {
    if (!max.enabled || !env.MAX_BOT_USERNAME) throw new AppError('MAX_DISABLED', 'Бот MAX ещё не настроен', 503);
    const token = randomToken(18);
    await this.prisma.system.user.update({
      where: { id: a.userId },
      data: { maxLinkHash: sha256(token), maxLinkExpires: new Date(Date.now() + 15 * 60_000) },
    });
    return { url: max.deepLink(`u_${token}`) };
  }

  @Delete('me/max')
  async unlinkStaffMax(@Auth() a: AuthCtx) {
    await this.prisma.system.user.update({ where: { id: a.userId }, data: { maxUserId: null } });
    return { ok: true };
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

    const reply = text.startsWith('/') ? await this.clientBot.linkCustomer('TELEGRAM', chatId, payload) : await this.clientBot.message('TELEGRAM', chatId, text);
    await telegram.send(chatId, reply.text, toTg(reply.buttons));
    // Кнопка «Записаться» в меню чата — клиент вернётся к записи в этот салон в одно касание
    if (reply.bookingUrl) await telegram.setMenuButton(chatId, 'Записаться', reply.bookingUrl);
  }

  private async onCallback(q: NonNullable<TgUpdate['callback_query']>) {
    const chatId = q.message ? String(q.message.chat.id) : null;
    if (!chatId) return telegram.answerCallback(q.id);
    const r = await this.clientBot.action('TELEGRAM', chatId, q.data ?? '');
    await telegram.answerCallback(q.id, r.note || undefined);
    if (q.message && r.reply) await telegram.editText(chatId, q.message.message_id, r.reply.text, toTg(r.reply.buttons));
  }
}

/** Кнопки общего формата → кнопки Telegram */
const toTg = toTelegramButtons;
