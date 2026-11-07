import { env } from '../config';

export type InlineButton = { text: string; callback_data?: string; url?: string };
export type TgResult = { ok: boolean; error?: string; blocked?: boolean; result?: unknown };

/**
 * Минимальный клиент Telegram Bot API. Транспорт можно подменить в тестах:
 *   telegram.transport = async (method, body) => ({ ok: true })
 */
export const telegram = {
  get enabled() {
    return !!env.TELEGRAM_BOT_TOKEN;
  },

  transport: async (method: string, body: object): Promise<TgResult> => {
    if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, error: 'telegram disabled' };
    try {
      const res = await fetch(`${env.TELEGRAM_API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: unknown };
      return {
        ok: !!json.ok,
        error: json.ok ? undefined : json.description ?? `HTTP ${res.status}`,
        // 403: пользователь заблокировал бота — дальше слать нельзя, переходим на SMS
        blocked: res.status === 403,
        result: json.result,
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  send(chatId: string, text: string, buttons?: InlineButton[][]) {
    return this.transport('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(buttons?.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
    });
  },

  editText(chatId: string, messageId: number, text: string, buttons?: InlineButton[][]) {
    return this.transport('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: buttons ?? [] },
    });
  },

  answerCallback(id: string, text?: string) {
    return this.transport('answerCallbackQuery', { callback_query_id: id, text });
  },

  /** Зарегистрировать вебхук (вызывается воркером при старте). */
  setWebhook(url: string, secret: string) {
    return this.transport('setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'callback_query'] });
  },

  deepLink(payload: string) {
    return env.TELEGRAM_BOT_USERNAME ? `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${payload}` : null;
  },
};

/** Экранирование для parse_mode=HTML */
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
