/**
 * Фоновый воркер (отдельный контейнер): напоминания клиентам и проверка подписок.
 * Очередь — сама таблица Reminder (FOR UPDATE SKIP LOCKED): отдельный Redis/BullMQ не нужен,
 * задачи переживают перезапуск, а можно запустить несколько воркеров параллельно.
 */
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { purgeDeletedTenants } from './auth/account.controller';
import { billingTick } from './billing/billing.service';
import { env } from './config';
import { telegram } from './notify/telegram';
import { processDueReminders } from './reminders/process';

const db = new PrismaClient({ datasourceUrl: env.SYSTEM_DATABASE_URL });
const log = (msg: string, extra?: unknown) => console.log(JSON.stringify({ time: new Date().toISOString(), msg, ...(extra ? { extra } : {}) }));

let stopping = false;
async function loop(name: string, everyMs: number, fn: () => Promise<unknown>) {
  while (!stopping) {
    try {
      const r = await fn();
      if (r && Object.values(r as object).some((v) => typeof v === 'number' && v > 0)) log(name, r);
    } catch (e) {
      log(`${name}: error`, (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

async function main() {
  log('worker started', { telegram: telegram.enabled, sms: !!env.SMS_RU_API_KEY });
  if (telegram.enabled && env.API_PUBLIC_URL && env.TELEGRAM_WEBHOOK_SECRET) {
    const r = await telegram.setWebhook(`${env.API_PUBLIC_URL}/webhooks/telegram`, env.TELEGRAM_WEBHOOK_SECRET);
    log('telegram setWebhook', r.ok ? 'ok' : r.error);
  }
  await Promise.all([
    loop('reminders', 30_000, () => processDueReminders(db)),
    loop('billing', 60 * 60_000, () => billingTick(db)),
    loop('purge', 6 * 60 * 60_000, () => purgeDeletedTenants(db)),
  ]);
}

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    stopping = true;
    db.$disconnect().finally(() => process.exit(0));
  });
}
main();
