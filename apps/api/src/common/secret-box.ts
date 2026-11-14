/**
 * Шифрование секретов салонов в базе (ключ ЮKassa): AES-256-GCM.
 * Ключ — SECRETS_KEY из .env (если не задан — производный от JWT_SECRET).
 * Утечка дампа базы без .env не раскрывает ключи магазинов.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config';

const key = () => createHash('sha256').update(`${env.SECRETS_KEY ?? env.JWT_SECRET}:mioflow-secrets:v1`).digest();

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function open(sealed: string): string {
  const [v, iv, tag, data] = sealed.split('.');
  if (v !== 'v1') throw new Error('unknown secret format');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}
