/**
 * Вход клиентов через Яндекс ID и VK ID (OAuth 2.0 с PKCE). Оба сервиса — российские, данные не уходят за рубеж.
 * Кнопки появляются, только если заданы ключи приложения в .env (см. docs/RUNBOOK.md).
 * Методы exchange/profile можно подменить в тестах.
 */
import { createHash, randomBytes } from 'node:crypto';
import { env } from '../config';
import { normalizePhone } from '../common/phone';

export type Provider = 'yandex' | 'vk';
export type OAuthProfile = { id: string; email: string | null; name: string; phone: string | null };

export const redirectUri = (p: Provider) => `${env.API_PUBLIC_URL ?? `${env.PUBLIC_WEB_URL}/v1`}/client/oauth/${p}/callback`;
export const enabledProviders = (): Provider[] => [
  ...(env.YANDEX_CLIENT_ID && env.YANDEX_CLIENT_SECRET ? (['yandex'] as const) : []),
  ...(env.VKID_CLIENT_ID ? (['vk'] as const) : []),
];

export function pkce() {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url'), state: randomBytes(16).toString('base64url') };
}

export function authorizeUrl(p: Provider, state: string, challenge: string) {
  if (p === 'yandex') {
    const q = new URLSearchParams({ response_type: 'code', client_id: env.YANDEX_CLIENT_ID!, redirect_uri: redirectUri(p), state, code_challenge: challenge, code_challenge_method: 'S256' });
    return `https://oauth.yandex.ru/authorize?${q}`;
  }
  const q = new URLSearchParams({ response_type: 'code', client_id: env.VKID_CLIENT_ID!, redirect_uri: redirectUri(p), state, code_challenge: challenge, code_challenge_method: 'S256', scope: 'email phone' });
  return `https://id.vk.com/authorize?${q}`;
}

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const json = async (r: Response) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`); return j as any; };

export const oauth = {
  /** Код из ответа провайдера → профиль пользователя */
  async profile(p: Provider, q: { code: string; verifier: string; state: string; deviceId?: string }): Promise<OAuthProfile> {
    if (p === 'yandex') {
      const tok = await json(await fetch('https://oauth.yandex.ru/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ grant_type: 'authorization_code', code: q.code, client_id: env.YANDEX_CLIENT_ID!, client_secret: env.YANDEX_CLIENT_SECRET!, code_verifier: q.verifier }),
        signal: AbortSignal.timeout(15_000),
      }));
      const u = await json(await fetch('https://login.yandex.ru/info?format=json', { headers: { Authorization: `OAuth ${tok.access_token}` }, signal: AbortSignal.timeout(15_000) }));
      return {
        id: String(u.id), email: u.default_email ? String(u.default_email).toLowerCase() : null,
        name: String(u.real_name || u.display_name || u.login || 'Клиент').slice(0, 100),
        phone: u.default_phone?.number ? normalizePhone(String(u.default_phone.number)) : null,
      };
    }
    const tok = await json(await fetch('https://id.vk.com/oauth2/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ grant_type: 'authorization_code', code: q.code, code_verifier: q.verifier, client_id: env.VKID_CLIENT_ID!, device_id: q.deviceId ?? '', redirect_uri: redirectUri(p), state: q.state }),
      signal: AbortSignal.timeout(15_000),
    }));
    const info = await json(await fetch('https://id.vk.com/oauth2/user_info', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: env.VKID_CLIENT_ID!, access_token: tok.access_token }), signal: AbortSignal.timeout(15_000),
    }));
    const u = info.user ?? {};
    return {
      id: String(u.user_id ?? tok.user_id), email: u.email ? String(u.email).toLowerCase() : null,
      name: [u.first_name, u.last_name].filter(Boolean).join(' ').slice(0, 100) || 'Клиент',
      phone: u.phone ? normalizePhone(String(u.phone)) : null,
    };
  },
};
