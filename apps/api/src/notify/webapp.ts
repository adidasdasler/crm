import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Проверка подписанных данных мини-приложения (initData). Telegram и MAX подписывают одинаково:
 * secret = HMAC_SHA256(key="WebAppData", bot_token); hash = HMAC_SHA256(secret, строки «ключ=значение»,
 * отсортированные по ключу, через \n, без hash). Возвращает пользователя или null (подпись неверна, данные старше суток).
 */
export function verifyWebAppData(initData: string, botToken: string | undefined, maxAgeSec = 86_400): { id: string; firstName?: string } | null {
  if (!botToken || !initData || initData.length > 4096) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash')?.toLowerCase();
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = createHmac('sha256', secret).update(check).digest();
  if (!timingSafeEqual(calc, Buffer.from(hash, 'hex'))) return null;
  const authDate = Number(params.get('auth_date'));
  // auth_date в секундах; MAX может прислать миллисекунды — приводим
  const sec = authDate > 1e12 ? authDate / 1000 : authDate;
  if (!sec || Date.now() / 1000 - sec > maxAgeSec || sec - Date.now() / 1000 > 300) return null;
  try {
    const user = JSON.parse(params.get('user') ?? 'null') as { id?: number | string; user_id?: number | string; first_name?: string } | null;
    const id = user?.id ?? user?.user_id;
    return id ? { id: String(id), firstName: user?.first_name } : null;
  } catch {
    return null;
  }
}
