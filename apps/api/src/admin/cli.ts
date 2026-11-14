/**
 * Аккаунты панели владельца — создаются ТОЛЬКО на сервере (через интернет их не создать):
 *   sudo docker compose exec api node dist/admin/cli.js create you@mail.ru
 *   sudo docker compose exec api node dist/admin/cli.js reset you@mail.ru     — новый пароль и новый код
 *   sudo docker compose exec api node dist/admin/cli.js delete you@mail.ru
 *   sudo docker compose exec api node dist/admin/cli.js list
 * Печатает пароль и QR-код: отсканируйте его приложением Яндекс Ключ или Google Authenticator.
 */
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import * as QRCode from 'qrcode';
import { seal } from '../common/secret-box';
import { env } from '../config';
import { newTotpSecret, otpauthUrl } from './totp';

const db = new PrismaClient({ datasourceUrl: env.SYSTEM_DATABASE_URL });
const password = () => randomBytes(12).toString('base64url');

async function issue(email: string, exists: boolean) {
  const pass = password();
  const secret = newTotpSecret();
  const data = { passwordHash: await argon2.hash(pass, { type: argon2.argon2id }), totpSecretEnc: seal(secret), failedAttempts: 0, lockedUntil: null };
  if (exists) await db.adminUser.update({ where: { email }, data });
  else await db.adminUser.create({ data: { email, ...data } });
  const url = otpauthUrl(email, secret);
  console.log(`\n✓ Аккаунт панели: ${email}`);
  console.log(`  Пароль: ${pass}   ← сохраните в менеджере паролей, больше он не покажется`);
  console.log('\n  Отсканируйте QR-код приложением Яндекс Ключ или Google Authenticator:\n');
  console.log(await QRCode.toString(url, { type: 'terminal', small: true }));
  console.log(`  Если QR не сканируется — введите ключ вручную: ${secret}`);
  console.log(`\n  Вход: ${env.PUBLIC_WEB_URL}/admin\n`);
}

async function main() {
  const [cmd, raw] = process.argv.slice(2);
  const email = raw?.trim().toLowerCase();
  if (cmd === 'list') {
    for (const a of await db.adminUser.findMany({ orderBy: { createdAt: 'asc' } })) console.log(`${a.email}  последний вход: ${a.lastLoginAt?.toISOString() ?? '—'} ${a.lastLoginIp ?? ''}`);
    return;
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !['create', 'reset', 'delete'].includes(cmd)) {
    console.log('Использование: node dist/admin/cli.js create|reset|delete <email>  или  list');
    process.exitCode = 1;
    return;
  }
  const exists = !!(await db.adminUser.findUnique({ where: { email } }));
  if (cmd === 'delete') {
    if (exists) await db.adminUser.delete({ where: { email } });
    console.log(exists ? `✓ Удалён ${email}` : 'Такого аккаунта нет');
    return;
  }
  if (cmd === 'create' && exists) { console.log('Уже есть. Для нового пароля и кода: reset'); process.exitCode = 1; return; }
  if (cmd === 'reset' && !exists) { console.log('Такого аккаунта нет. Создайте: create'); process.exitCode = 1; return; }
  await issue(email, exists);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
