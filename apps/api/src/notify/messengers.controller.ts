import { Body, Controller, Headers, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../common/auth';
import { AppError } from '../common/errors';
import { sha256 } from '../common/crypto';
import { PrismaService } from '../common/prisma.service';
import { env } from '../config';
import { max, vk } from './channels';
import { ClientBotService } from './client-bot.service';
import { esc } from './telegram';

/** Короткая запись в лог без персональных данных — чтобы видеть, доходят ли события и почему не уходят ответы */
const log = (msg: string, extra?: unknown) => console.log(JSON.stringify({ time: new Date().toISOString(), msg, ...(extra ? { extra } : {}) }));

const safeEqual = (a?: string, b?: string) => !!a && !!b && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Вебхуки клиентских ботов ВКонтакте и MAX. Логика общая с Telegram (ClientBotService):
 * привязка клиента по ссылке после записи и кнопки «Подтвердить»/«Отменить».
 */
@Public()
@Controller('webhooks')
export class MessengersController {
  constructor(private readonly clientBot: ClientBotService, private readonly prisma: PrismaService) {}

  /** Сотрудник открыл ссылку из приложения «Уведомления в MAX / ВКонтакте» (payload u_<токен>) */
  private async linkStaff(channel: 'MAX' | 'VK', userId: string, token: string) {
    const db = this.prisma.system;
    const user = channel === 'MAX'
      ? await db.user.findUnique({ where: { maxLinkHash: sha256(token) } })
      : await db.user.findUnique({ where: { vkLinkHash: sha256(token) } });
    const expires = channel === 'MAX' ? user?.maxLinkExpires : user?.vkLinkExpires;
    if (!user || user.deletedAt || !expires || expires < new Date()) {
      return `Ссылка устарела. Получите новую в приложении MioFlow: «Ещё» → «Уведомления ${channel === 'MAX' ? 'в MAX' : 'во ВКонтакте'}».`;
    }
    await db.user.update({
      where: { id: user.id },
      data: channel === 'MAX' ? { maxUserId: userId, maxLinkHash: null, maxLinkExpires: null } : { vkUserId: userId, vkLinkHash: null, vkLinkExpires: null },
    });
    return `Готово, ${esc(user.name)}! Сюда будут приходить новые онлайн-записи, отмены и переносы, а также коды входа.`;
  }

  /**
   * ВКонтакте, Callback API (версия 5.199). В настройках сообщества указывается адрес
   * https://<домен>/v1/webhooks/vk, секретный ключ VK_SECRET и события message_new, message_event.
   */
  @HttpCode(200)
  @Post('vk')
  async vk(@Body() body: { type?: string; secret?: string; object?: any }, @Res() res: Response) {
    if (body.type === 'confirmation') {
      log('vk confirmation', { configured: !!env.VK_CONFIRMATION_CODE });
      return res.type('text/plain').send(env.VK_CONFIRMATION_CODE ?? '');
    }
    if (!safeEqual(body.secret, env.VK_SECRET)) {
      log('vk: неверный секретный ключ — сравните «Секретный ключ» в Callback API и VK_SECRET', { hasSecret: !!body.secret });
      throw new AppError('FORBIDDEN', 'bad secret', 403);
    }
    log('vk event', { type: body.type });
    try {
      if (body.type === 'message_new') {
        // Версия API в Callback API ниже 5.103 присылает сообщение прямо в object
        const m = body.object?.message ?? body.object ?? {};
        const userId = String(m.from_id ?? '');
        // Ссылка vk.me/<сообщество>?ref=b_<токен> передаёт токен в поле ref первого сообщения
        const payload = typeof m.ref === 'string' ? m.ref : '';
        if (userId && payload.startsWith('u_')) {
          const r = await vk.send(userId, await this.linkStaff('VK', userId, payload.slice(2)));
          if (!r.ok) log('vk: ответ не отправлен', { error: r.error });
        } else if (userId) {
          const text = typeof m.text === 'string' ? m.text : '';
          const reply = payload || !text ? await this.clientBot.linkCustomer('VK', userId, payload) : await this.clientBot.message('VK', userId, text);
          const r = await vk.send(userId, reply.text, reply.buttons);
          if (!r.ok) log('vk: ответ не отправлен', { error: r.error });
        }
      } else if (body.type === 'message_event') {
        const o = body.object ?? {};
        let data = '';
        try { data = (typeof o.payload === 'string' ? JSON.parse(o.payload) : o.payload)?.d ?? ''; } catch { data = ''; }
        const r = await this.clientBot.action('VK', String(o.user_id), data);
        await vk.answer(String(o.event_id), String(o.user_id), String(o.peer_id), r.note || 'Готово');
        if (r.reply) await vk.send(String(o.user_id), r.reply.text, r.reply.buttons);
      }
    } catch (e) {
      // VK повторяет доставку при ошибке — отвечаем ok, чтобы не было бесконечных повторов
      log('vk: ошибка обработки', { error: (e as Error).message });
    }
    return res.type('text/plain').send('ok');
  }

  /**
   * MAX (https://dev.max.ru). Подписка на вебхук создаётся воркером при старте
   * (POST /subscriptions) с секретом MAX_WEBHOOK_SECRET — он приходит в заголовке.
   */
  @HttpCode(200)
  @Post('max')
  async max(@Headers('x-max-bot-api-secret') secret: string | undefined, @Body() u: { update_type?: string; payload?: string | null; user?: any; callback?: any; message?: any }) {
    if (!safeEqual(secret, env.MAX_WEBHOOK_SECRET)) throw new AppError('FORBIDDEN', 'bad secret', 403);
    try {
      if (u.update_type === 'bot_started') {
        const userId = String(u.user?.user_id ?? '');
        if (userId && (u.payload ?? '').startsWith('u_')) {
          await max.send(userId, await this.linkStaff('MAX', userId, u.payload!.slice(2)));
        } else if (userId) {
          const reply = await this.clientBot.linkCustomer('MAX', userId, u.payload ?? '');
          await max.send(userId, reply.text, reply.buttons);
        }
      } else if (u.update_type === 'message_created') {
        // Комментарий к оценке или любое сообщение боту
        const userId = String(u.message?.sender?.user_id ?? '');
        const text = String(u.message?.body?.text ?? '');
        // Свои же сообщения бота тоже приходят как message_created — на них не отвечаем, иначе зациклимся
        if (userId && text && !u.message?.sender?.is_bot) {
          const reply = await this.clientBot.message('MAX', userId, text);
          await max.send(userId, reply.text, reply.buttons);
        }
      } else if (u.update_type === 'message_callback') {
        const userId = String(u.callback?.user?.user_id ?? '');
        const r = await this.clientBot.action('MAX', userId, u.callback?.payload ?? '');
        await max.answer(String(u.callback?.callback_id ?? ''), r.note || 'Готово');
        if (r.reply) await max.send(userId, r.reply.text, r.reply.buttons);
      }
    } catch {
      // не ломаем доставку обновлений
    }
    return { ok: true };
  }
}
