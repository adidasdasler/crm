import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config';

export type InlineButton = { text: string; callback_data?: string; url?: string; web_app?: { url: string } };
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
        // 403: пользователь заблокировал бота — дальше слать нельзя, переходим к следующему каналу
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

  /** Кнопка меню в чате с клиентом — открывает запись в салон как мини-приложение */
  setMenuButton(chatId: string, text: string, url: string) {
    return this.transport('setChatMenuButton', { chat_id: chatId, menu_button: { type: 'web_app', text, web_app: { url } } });
  },

  /**
   * Проверка данных мини-приложения (Telegram WebApp initData):
   * secret = HMAC_SHA256(key="WebAppData", bot_token); hash = HMAC_SHA256(secret, data_check_string).
   * Возвращает пользователя Telegram или null, если подпись неверна или данные старше суток.
   */
  verifyInitData(initData: string, maxAgeSec = 86_400): { id: string; firstName?: string } | null {
    if (!env.TELEGRAM_BOT_TOKEN || !initData || initData.length > 4096) return null;
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
    params.delete('hash');
    const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(env.TELEGRAM_BOT_TOKEN).digest();
    const calc = createHmac('sha256', secret).update(check).digest();
    if (!timingSafeEqual(calc, Buffer.from(hash, 'hex'))) return null;
    const authDate = Number(params.get('auth_date'));
    if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
    try {
      const user = JSON.parse(params.get('user') ?? 'null') as { id?: number; first_name?: string } | null;
      return user?.id ? { id: String(user.id), firstName: user.first_name } : null;
    } catch {
      return null;
    }
  },

  deepLink(payload: string) {
    return env.TELEGRAM_BOT_USERNAME ? `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${payload}` : null;
  },
};

/** Экранирование для parse_mode=HTML */
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
