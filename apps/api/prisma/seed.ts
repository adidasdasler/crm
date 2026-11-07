/**
 * Seed: тарифы (обязательно) + демо-салон (только вне production).
 * Запуск: pnpm --filter @salon/api prisma:seed
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const db = new PrismaClient({ datasourceUrl: process.env.SYSTEM_DATABASE_URL });

/** Цены в копейках. Это гипотеза — проверьте на первых клиентах. */
export const PLANS = [
  { code: 'START', name: 'Старт', priceMonthly: 99000, priceYearly: 990000, limits: { masters: 2, smsPerMonth: 50 }, sortOrder: 1 },
  { code: 'BUSINESS', name: 'Бизнес', priceMonthly: 199000, priceYearly: 1990000, limits: { masters: 6, smsPerMonth: 200 }, sortOrder: 2 },
  { code: 'NETWORK', name: 'Сеть', priceMonthly: 399000, priceYearly: 3990000, limits: { masters: 15, smsPerMonth: 500 }, sortOrder: 3 },
];

export async function seedPlans(client = db) {
  for (const p of PLANS) {
    await client.plan.upsert({ where: { code: p.code }, update: p, create: p });
  }
}

const week = (from: string, to: string) => ({
  '1': [[from, to]], '2': [[from, to]], '3': [[from, to]], '4': [[from, to]], '5': [[from, to]], '6': [[from, '18:00']], '7': [],
});

async function seedDemo() {
  if (await db.tenant.findUnique({ where: { slug: 'demo' } })) return console.log('demo: уже есть');
  const plan = await db.plan.findUniqueOrThrow({ where: { code: 'BUSINESS' } });
  const user = await db.user.create({
    data: { email: 'demo@salon.local', name: 'Анна (владелец)', passwordHash: await argon2.hash('demo12345', { type: argon2.argon2id }) },
  });
  const t = await db.tenant.create({ data: { slug: 'demo', name: 'Студия «Лаванда»', phone: '+79990000000', address: 'Москва, ул. Примерная, 1' } });
  const anna = await db.resource.create({ data: { tenantId: t.id, name: 'Анна', position: 'Мастер маникюра', schedule: week('10:00', '20:00'), color: '#8B5CF6' } });
  const olga = await db.resource.create({ data: { tenantId: t.id, name: 'Ольга', position: 'Бровист', schedule: week('11:00', '19:00'), color: '#EC4899' } });
  await db.membership.create({ data: { tenantId: t.id, userId: user.id, role: 'OWNER', resourceId: anna.id } });
  await db.subscription.create({ data: { tenantId: t.id, planId: plan.id, status: 'TRIAL', trialEndsAt: new Date(Date.now() + 14 * 86400_000) } });
  const services = [
    { name: 'Маникюр с покрытием', price: 220000, duration: 120, bufferTime: 10, r: [anna] },
    { name: 'Маникюр без покрытия', price: 120000, duration: 60, bufferTime: 0, r: [anna] },
    { name: 'Коррекция и окрашивание бровей', price: 140000, duration: 45, bufferTime: 0, r: [olga] },
    { name: 'Ламинирование ресниц', price: 250000, duration: 75, bufferTime: 15, r: [olga] },
  ];
  for (const { r, ...s } of services) {
    const svc = await db.service.create({ data: { ...s, tenantId: t.id } });
    await db.serviceResource.createMany({ data: r.map((x) => ({ tenantId: t.id, serviceId: svc.id, resourceId: x.id })) });
  }
  await db.customer.createMany({
    data: [
      { tenantId: t.id, name: 'Мария Иванова', phone: '+79161234567', tags: ['VIP'] },
      { tenantId: t.id, name: 'Екатерина Смирнова', phone: '+79037654321' },
    ],
  });
  console.log('demo: создан — demo@salon.local / demo12345, запись: /b/demo');
}

if (require.main === module) {
  (async () => {
    await seedPlans();
    console.log('plans: ok');
    if (process.env.NODE_ENV !== 'production') await seedDemo();
  })()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => db.$disconnect());
}
