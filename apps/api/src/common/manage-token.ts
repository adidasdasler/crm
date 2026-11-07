import { createHmac } from 'node:crypto';
import { env } from '../config';
import { sha256 } from './crypto';

/**
 * Токен ссылки «управлять записью» вычисляется из id записи (HMAC), поэтому его можно
 * восстановить в любой момент — например, чтобы вставить ссылку в напоминание.
 * В БД хранится только SHA-256 токена (для поиска записи по ссылке).
 */
const key = createHmac('sha256', env.JWT_SECRET).update('salon:manage-token:v1').digest();

export function manageToken(bookingId: string): string {
  return createHmac('sha256', key).update(bookingId).digest('base64url').slice(0, 22);
}
export const manageTokenHash = (bookingId: string) => sha256(manageToken(bookingId));
export const manageUrl = (slug: string, bookingId: string) => `${env.PUBLIC_WEB_URL}/b/${slug}/manage/${manageToken(bookingId)}`;
