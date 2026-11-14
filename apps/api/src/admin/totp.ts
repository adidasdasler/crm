/**
 * Одноразовые коды (TOTP, RFC 6238) — как в Яндекс Ключе, Google Authenticator, 1Password.
 * Код меняется каждые 30 секунд; принимаем текущий и соседние (часы телефона могут чуть спешить).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(buf: Buffer) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function unbase32(s: string) {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32(randomBytes(20));

export function totp(secret: string, at = Date.now(), step = 30) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / step)));
  const h = createHmac('sha1', unbase32(secret)).update(counter).digest();
  const off = h[h.length - 1] & 15;
  const n = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

export function verifyTotp(secret: string, code: string, at = Date.now()) {
  const c = code.replace(/\D/g, '');
  if (c.length !== 6) return false;
  return [-1, 0, 1].some((d) => timingSafeEqual(Buffer.from(totp(secret, at + d * 30_000)), Buffer.from(c)));
}

export const otpauthUrl = (email: string, secret: string) =>
  `otpauth://totp/${encodeURIComponent(`MioFlow:${email}`)}?secret=${secret}&issuer=MioFlow&algorithm=SHA1&digits=6&period=30`;
