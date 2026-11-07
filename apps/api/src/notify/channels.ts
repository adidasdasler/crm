/**
 * Каналы, по которым клиент получает напоминания: Telegram, MAX, ВКонтакте, Email.
 * Все бесплатны для салона — SMS не используем.
 * У каждого канала одинаковый интерфейс: текст (HTML-разметка Telegram) + кнопки.
 */
import { env } from '../config';
import { mailer } from './mailer';
import { InlineButton, telegram } from './telegram';

export type ChannelName = 'TELEGRAM' | 'MAX' | 'VK' | 'EMAIL';
/** data — действие кнопки («c:<id>» подтвердить, «x:<id>» отменить); url — ссылка */
export type Button = { text: string; data?: string; url?: string };
export type SendResult = { ok: boolean; error?: string; /** получатель запретил сообщения — канал отвязать */ blocked?: boolean };
export type Channel = { name: ChannelName; enabled: () => boolean; send: (to: string, html: string, buttons?: Button[][], subject?: string) => Promise<SendResult> };

export const stripHtml = (html: string) =>
  html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// ─── Telegram ───
const tgChannel: Channel = {
  name: 'TELEGRAM',
  enabled: () => telegram.enabled,
  send: (to, html, buttons) =>
    telegram.send(to, html, buttons?.map((row) => row.map((b): InlineButton => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data })))),
};

// ─── MAX (https://dev.max.ru/docs-api): POST /messages?user_id=…, токен в заголовке Authorization ───
export const max = {
  get enabled() {
    return !!env.MAX_BOT_TOKEN;
  },
  transport: async (method: 'GET' | 'POST' | 'PATCH', path: string, body?: object): Promise<{ ok: boolean; status: number; json: any }> => {
    try {
      const res = await fetch(`${env.MAX_API_BASE}${path}`, {
        method,
        headers: { Authorization: env.MAX_BOT_TOKEN ?? '', 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
      return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
    } catch (e) {
      return { ok: false, status: 0, json: { message: (e as Error).message } };
    }
  },
  deepLink: (payload: string) => (env.MAX_BOT_USERNAME ? `https://max.ru/${env.MAX_BOT_USERNAME}?start=${payload}` : null),
  keyboard: (buttons?: Button[][]) =>
    buttons?.length
      ? [{ type: 'inline_keyboard', payload: { buttons: buttons.map((r) => r.map((b) => (b.url ? { type: 'link', text: b.text, url: b.url } : { type: 'callback', text: b.text, payload: b.data }))) } }]
      : undefined,
  async send(userId: string, html: string, buttons?: Button[][]): Promise<SendResult> {
    const r = await this.transport('POST', `/messages?user_id=${encodeURIComponent(userId)}`, { text: html, format: 'html', attachments: this.keyboard(buttons) });
    return { ok: r.ok, error: r.ok ? undefined : r.json?.message ?? `HTTP ${r.status}`, blocked: r.status === 403 };
  },
  /** Ответ на нажатие кнопки: всплывающее уведомление у пользователя */
  answer: (callbackId: string, text: string) => max.transport('POST', `/answers?callback_id=${encodeURIComponent(callbackId)}`, { notification: text }),
};
const maxChannel: Channel = { name: 'MAX', enabled: () => max.enabled, send: (to, html, b) => max.send(to, html, b) };

// ─── ВКонтакте (сообщения сообщества, API 5.199) ───
export const vk = {
  get enabled() {
    return !!env.VK_GROUP_TOKEN;
  },
  transport: async (method: string, params: Record<string, string | number>): Promise<{ ok: boolean; json: any }> => {
    try {
      const body = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), access_token: env.VK_GROUP_TOKEN ?? '', v: '5.199' });
      const res = await fetch(`https://api.vk.com/method/${method}`, { method: 'POST', body, signal: AbortSignal.timeout(10_000) });
      const json = (await res.json().catch(() => ({}))) as any;
      return { ok: !json.error, json };
    } catch (e) {
      return { ok: false, json: { error: { error_msg: (e as Error).message } } };
    }
  },
  deepLink: (ref: string) => (env.VK_GROUP_SCREEN_NAME ? `https://vk.me/${env.VK_GROUP_SCREEN_NAME}?ref=${ref}` : null),
  keyboard: (buttons?: Button[][]) =>
    JSON.stringify({
      inline: true,
      buttons: (buttons ?? []).map((r) =>
        r.map((b) => (b.url ? { action: { type: 'open_link', link: b.url, label: b.text.slice(0, 40) } } : { action: { type: 'callback', label: b.text.slice(0, 40), payload: JSON.stringify({ d: b.data }) } })),
      ),
    }),
  async send(userId: string, html: string, buttons?: Button[][]): Promise<SendResult> {
    const r = await this.transport('messages.send', {
      user_id: userId, random_id: Math.floor(Math.random() * 2 ** 31), message: stripHtml(html), ...(buttons?.length ? { keyboard: this.keyboard(buttons) } : {}),
    });
    const code = r.json?.error?.error_code;
    // 901 — пользователь запретил сообщения от сообщества
    return { ok: r.ok, error: r.ok ? undefined : r.json?.error?.error_msg, blocked: code === 901 || code === 900 };
  },
  answer: (eventId: string, userId: string, peerId: string, text: string) =>
    vk.transport('messages.sendMessageEventAnswer', { event_id: eventId, user_id: userId, peer_id: peerId, event_data: JSON.stringify({ type: 'show_snackbar', text: text.slice(0, 90) }) }),
};
const vkChannel: Channel = { name: 'VK', enabled: () => vk.enabled, send: (to, html, b) => vk.send(to, html, b) };

// ─── Email: кнопки превращаются в ссылки ───
const emailChannel: Channel = {
  name: 'EMAIL',
  enabled: () => !!env.SMTP_URL,
  async send(to, html, buttons, subject) {
    const links = (buttons ?? []).flat().filter((b) => b.url).map((b) => `${b.text}: ${b.url}`);
    const ok = await mailer.send({ to, subject: subject ?? 'Напоминание о записи', text: [stripHtml(html), '', ...links].join('\n') });
    return { ok, error: ok ? undefined : 'email not sent' };
  },
};

/** Порядок важен: сначала мессенджеры с кнопками, затем почта. */
export const CHANNELS: Channel[] = [tgChannel, maxChannel, vkChannel, emailChannel];
