/**
 * Seed: тарифы (обязательно) + демо-салон (только вне production).
 * Запуск: pnpm --filter @salon/api prisma:seed
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedDemo } from '../src/demo/demo';

const db = new PrismaClient({ datasourceUrl: process.env.SYSTEM_DATABASE_URL });

/**
 * Цены в копейках. Годовая оплата — скидка 20% (≈ 2,4 месяца бесплатно).
 * Напоминания во всех тарифах бесплатны и без лимита: Telegram, MAX, ВКонтакте, email (SMS не используем).
 */
const yearly = (monthly: number) => Math.round((monthly * 12 * 0.8) / 100) * 100;
export const PLANS = [
  { code: 'SOLO', name: 'Соло', priceMonthly: 29000, priceYearly: yearly(29000), limits: { masters: 1 }, sortOrder: 0 },
  { code: 'START', name: 'Старт', priceMonthly: 69000, priceYearly: yearly(69000), limits: { masters: 5 }, sortOrder: 1 },
  { code: 'BUSINESS', name: 'Бизнес', priceMonthly: 149000, priceYearly: yearly(149000), limits: { masters: 10 }, sortOrder: 2 },
  { code: 'NETWORK', name: 'Сеть', priceMonthly: 299000, priceYearly: yearly(299000), limits: { masters: 30 }, sortOrder: 3 },
];

export async function seedPlans(client = db) {
  for (const p of PLANS) {
    await client.plan.upsert({ where: { code: p.code }, update: p, create: p });
  }
}

if (require.main === module) {
  (async () => {
    await seedPlans();
    console.log('plans: ok');
    // Демо-салон: всегда в разработке, на сервере — только если явно включён SEED_DEMO=true
    if (process.env.NODE_ENV !== 'production' || process.env.SEED_DEMO === 'true') console.log((await seedDemo(db)) ? 'demo: создан — demo@salon.local / demo12345, запись: /b/demo' : 'demo: уже есть');
  })()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => db.$disconnect());
}
