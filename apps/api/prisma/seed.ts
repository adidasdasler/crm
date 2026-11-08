/**
 * Seed: тарифы (обязательно) + демо-салон (только вне production).
 * Запуск: pnpm --filter @salon/api prisma:seed
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const db = new PrismaClient({ datasourceUrl: process.env.SYSTEM_DATABASE_URL });

/**
 * Цены в копейках. Годовая оплата — скидка 20% (≈ 2,4 месяца бесплатно).
 * Напоминания во всех тарифах бесплатны и без лимита: Telegram, MAX, ВКонтакте, email (SMS не используем).
 */
const yearly = (monthly: number) => Math.round((monthly * 12 * 0.8) / 100) * 100;
export const PLANS = [
  { code: 'SOLO', name: 'Соло', priceMonthly: 29000, priceYearly: yearly(29000), limits: { masters: 1 }, sortOrder: 0 },
  { code: 'START', name: 'Старт', priceMonthly: 69000, priceYearly: yearly(69000), limits: { masters: 3 }, sortOrder: 1 },
  { code: 'BUSINESS', name: 'Бизнес', priceMonthly: 149000, priceYearly: yearly(149000), limits: { masters: 10 }, sortOrder: 2 },
  { code: 'NETWORK', name: 'Сеть', priceMonthly: 299000, priceYearly: yearly(299000), limits: { masters: 30 }, sortOrder: 3 },
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
  const anna = await db.resource.create({ data: { tenantId: t.id, name: 'Анна', position: 'Мастер маникюра', schedule: week('10:00', '20:00'), color: '#2F3BFF' } });
  const olga = await db.resource.create({ data: { tenantId: t.id, name: 'Ольга', position: 'Бровист', schedule: week('11:00', '19:00'), color: '#FF6F91' } });
  await db.membership.create({ data: { tenantId: t.id, userId: user.id, role: 'OWNER', resourceId: anna.id } });
  await db.subscription.create({ data: { tenantId: t.id, planId: plan.id, status: 'TRIAL', trialEndsAt: new Date(Date.now() + 14 * 86400_000) } });
  const services = [
    { name: 'Маникюр с покрытием', price: 220000, duration: 120, bufferTime: 10, r: [anna] },
    { name: 'Маникюр без покрытия', price: 120000, duration: 60, bufferTime: 0, r: [anna] },
    { name: 'Коррекция и окрашивание бровей', price: 140000, duration: 45, bufferTime: 0, r: [olga] },
    { name: 'Ламинирование ресниц', price: 250000, duration: 75, bufferTime: 15, r: [olga] },
  ];
  const svcIds: Record<string, string> = {};
  for (const { r, ...s } of services) {
    const svc = await db.service.create({ data: { ...s, tenantId: t.id } });
    svcIds[s.name] = svc.id;
    await db.serviceResource.createMany({ data: r.map((x) => ({ tenantId: t.id, serviceId: svc.id, resourceId: x.id })) });
  }
  // Склад: материалы с партиями и нормами расхода (количества — в тысячных долях единицы)
  const day = (n: number) => new Date(Date.now() + n * 86400_000);
  const stock = [
    { name: 'Гель-лак', unit: 'мл', category: 'Покрытия', minStock: 30, trackExpiry: true, batches: [[20, 90000, 12], [30, 85000, 240]], norms: { 'Маникюр с покрытием': 500 } },
    { name: 'Пилки одноразовые', unit: 'шт', category: 'Расходники', minStock: 50, trackExpiry: false, batches: [[40, 600, null]], norms: { 'Маникюр с покрытием': 1000, 'Маникюр без покрытия': 1000 } },
    { name: 'Краска для бровей', unit: 'мл', category: 'Брови', minStock: 20, trackExpiry: true, batches: [[60, 4000, 150]], norms: { 'Коррекция и окрашивание бровей': 1000 } },
    { name: 'Состав для ламинирования (саше)', unit: 'шт', category: 'Ресницы', minStock: 10, trackExpiry: true, batches: [[24, 35000, 90]], norms: { 'Ламинирование ресниц': 1000 } },
  ] as const;
  for (const m of stock) {
    const total = m.batches.reduce((a, [q]) => a + q * 1000, 0);
    const mat = await db.material.create({
      data: { tenantId: t.id, name: m.name, unit: m.unit, category: m.category, minStock: m.minStock * 1000, trackExpiry: m.trackExpiry, stock: total, lastCost: m.batches[0][1] },
    });
    for (const [q, cost, exp] of m.batches) {
      const b = await db.materialBatch.create({ data: { tenantId: t.id, materialId: mat.id, qty: q * 1000, remaining: q * 1000, costPerUnit: cost, expiresAt: exp ? day(exp) : null } });
      await db.stockMovement.create({ data: { tenantId: t.id, materialId: mat.id, batchId: b.id, type: 'RECEIPT', qty: q * 1000, costPerUnit: cost, note: 'демо-приход' } });
    }
    for (const [svc, q] of Object.entries(m.norms)) await db.serviceMaterial.create({ data: { tenantId: t.id, serviceId: svcIds[svc], materialId: mat.id, qty: q } });
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
    // Демо-салон: всегда в разработке, на сервере — только если явно включён SEED_DEMO=true
    if (process.env.NODE_ENV !== 'production' || process.env.SEED_DEMO === 'true') await seedDemo();
  })()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => db.$disconnect());
}
