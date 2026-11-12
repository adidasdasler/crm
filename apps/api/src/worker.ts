/**
 * Фоновый воркер (отдельный контейнер): напоминания клиентам и проверка подписок.
 * Очередь — сама таблица Reminder (FOR UPDATE SKIP LOCKED): отдельный Redis/BullMQ не нужен,
 * задачи переживают перезапуск, а можно запустить несколько воркеров параллельно.
 */
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { demoResetTick } from './demo/demo';
import { waitlistTick } from './waitlist/waitlist';
import { purgeDeletedTenants } from './auth/account.controller';
import { billingTick } from './billing/billing.service';
import { env } from './config';
import { max } from './notify/channels';
import { telegram } from './notify/telegram';
import { insightsDigestTick } from './insights/digest';
import { processDueReminders } from './reminders/process';

const db = new PrismaClient({ datasourceUrl: env.SYSTEM_DATABASE_URL });
/** Роль приложения (RLS) — для расчёта свободного времени строго внутри салона */
const appDb = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
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
  log('worker started', { telegram: telegram.enabled, max: max.enabled, vk: !!env.VK_GROUP_TOKEN, email: !!env.SMTP_URL });
  if (max.enabled && env.API_PUBLIC_URL && env.MAX_WEBHOOK_SECRET) {
    const r = await max.transport('POST', '/subscriptions', {
      url: `${env.API_PUBLIC_URL}/webhooks/max`, update_types: ['bot_started', 'message_callback', 'message_created'], secret: env.MAX_WEBHOOK_SECRET,
    });
    log('max subscription', r.ok ? 'ok' : r.json);
  }
  if (telegram.enabled && env.API_PUBLIC_URL && env.TELEGRAM_WEBHOOK_SECRET) {
    const r = await telegram.setWebhook(`${env.API_PUBLIC_URL}/webhooks/telegram`, env.TELEGRAM_WEBHOOK_SECRET);
    log('telegram setWebhook', r.ok ? 'ok' : r.error);
  }
  await Promise.all([
    loop('reminders', 30_000, () => processDueReminders(db)),
    loop('billing', 60 * 60_000, () => billingTick(db)),
    loop('purge', 6 * 60 * 60_000, () => purgeDeletedTenants(db)),
    loop('insights', 60 * 60_000, () => insightsDigestTick(db)),
    loop('demo', 30 * 60_000, () => demoResetTick(db)),
    loop('waitlist', 3 * 60_000, () => waitlistTick(appDb, db)),
  ]);
}

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    stopping = true;
    Promise.all([db.$disconnect(), appDb.$disconnect()]).finally(() => process.exit(0));
  });
}
main();
