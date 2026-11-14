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

const safeEqual = (a?: string, b?: string) => !!a && !!b && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Вебхуки клиентских ботов ВКонтакте и MAX. Логика общая с Telegram (ClientBotService):
 * привязка клиента по ссылке после записи и кнопки «Подтвердить»/«Отменить».
 */
@Public()
@Controller('webhooks')
export class MessengersController {
  constructor(private readonly clientBot: ClientBotService, private readonly prisma: PrismaService) {}

  /** Сотрудник открыл ссылку из приложения «Уведомления в MAX» (payload u_<токен>) */
  private async linkStaff(userId: string, token: string) {
    const db = this.prisma.system;
    const user = await db.user.findUnique({ where: { maxLinkHash: sha256(token) } });
    if (!user || user.deletedAt || !user.maxLinkExpires || user.maxLinkExpires < new Date()) {
      return 'Ссылка устарела. Получите новую в приложении MioFlow: «Ещё» → «Уведомления в MAX».';
    }
    await db.user.update({ where: { id: user.id }, data: { maxUserId: userId, maxLinkHash: null, maxLinkExpires: null } });
    return `Готово, ${esc(user.name)}! Сюда будут приходить новые онлайн-записи, отмены и переносы, а также коды входа.`;
  }

  /**
   * ВКонтакте, Callback API (версия 5.199). В настройках сообщества указывается адрес
   * https://<домен>/v1/webhooks/vk, секретный ключ VK_SECRET и события message_new, message_event.
   */
  @HttpCode(200)
  @Post('vk')
  async vk(@Body() body: { type?: string; secret?: string; object?: any }, @Res() res: Response) {
    if (body.type === 'confirmation') return res.type('text/plain').send(env.VK_CONFIRMATION_CODE ?? '');
    if (!safeEqual(body.secret, env.VK_SECRET)) throw new AppError('FORBIDDEN', 'bad secret', 403);
    try {
      if (body.type === 'message_new') {
        const m = body.object?.message ?? {};
        const userId = String(m.from_id ?? '');
        // Ссылка vk.me/<сообщество>?ref=b_<токен> передаёт токен в поле ref первого сообщения
        const payload = typeof m.ref === 'string' ? m.ref : '';
        if (userId) {
          const text = typeof m.text === 'string' ? m.text : '';
          const reply = payload || !text ? await this.clientBot.linkCustomer('VK', userId, payload) : await this.clientBot.message('VK', userId, text);
          await vk.send(userId, reply.text, reply.buttons);
        }
      } else if (body.type === 'message_event') {
        const o = body.object ?? {};
        let data = '';
        try { data = (typeof o.payload === 'string' ? JSON.parse(o.payload) : o.payload)?.d ?? ''; } catch { data = ''; }
        const r = await this.clientBot.action('VK', String(o.user_id), data);
        await vk.answer(String(o.event_id), String(o.user_id), String(o.peer_id), r.note || 'Готово');
        if (r.reply) await vk.send(String(o.user_id), r.reply.text, r.reply.buttons);
      }
    } catch {
      // VK повторяет доставку при ошибке — отвечаем ok, чтобы не было бесконечных повторов
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
          await max.send(userId, await this.linkStaff(userId, u.payload!.slice(2)));
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
