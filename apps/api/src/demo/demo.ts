/**
 * Демо-салон «Студия Лаванда»: открытый вход для всех, кто хочет попробовать MioFlow без регистрации.
 * Опасные действия в демо закрыты (см. @NoDemo), уведомления не отправляются,
 * а каждую ночь данные возвращаются к исходным.
 */
import { DateTime } from 'luxon';
import type { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

export const DEMO_SLUG = 'demo';
export const DEMO_EMAIL = 'demo@salon.local';
export const DEMO_PASSWORD = 'demo12345';
const TZ = 'Europe/Moscow';
const TENANT = { name: 'Студия «Лаванда»', phone: '+79990000000', address: 'Москва, ул. Примерная, 1', timezone: TZ };

const week = (from: string, to: string) => ({
  '1': [[from, to]], '2': [[from, to]], '3': [[from, to]], '4': [[from, to]], '5': [[from, to]], '6': [[from, '18:00']], '7': [[from, '18:00']],
});

/** Создать демо-салон, если его ещё нет */
export async function seedDemo(db: PrismaClient) {
  if (await db.tenant.findUnique({ where: { slug: DEMO_SLUG } })) return false;
  const plan = await db.plan.findUniqueOrThrow({ where: { code: 'BUSINESS' } });
  const user = await db.user.create({ data: { email: DEMO_EMAIL, name: 'Анна (владелец)', passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }) } });
  const t = await db.tenant.create({ data: { slug: DEMO_SLUG, ...TENANT } });
  await db.membership.create({ data: { tenantId: t.id, userId: user.id, role: 'OWNER' } });
  await db.subscription.create({ data: { tenantId: t.id, planId: plan.id, status: 'TRIAL', trialEndsAt: new Date(Date.now() + 14 * 86400_000) } });
  await fillDemo(db, t.id, user.id);
  return true;
}

/** Вернуть демо к исходному виду: всё, что натворили посетители, стирается */
export async function resetDemo(db: PrismaClient, now = new Date()) {
  const t = await db.tenant.findUnique({ where: { slug: DEMO_SLUG } });
  if (!t) return false;
  const owner = await db.membership.findFirst({ where: { tenantId: t.id, role: 'OWNER' }, orderBy: { createdAt: 'asc' } });
  if (!owner) return false;
  const tenantId = t.id;
  const plan = await db.plan.findUniqueOrThrow({ where: { code: 'BUSINESS' } });
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
  await db.$transaction([
    db.passUse.deleteMany({ where: { tenantId } }),
    db.customerPass.deleteMany({ where: { tenantId } }),
    db.passPlan.deleteMany({ where: { tenantId } }),
    db.accountEntry.deleteMany({ where: { tenantId } }),
    db.review.deleteMany({ where: { tenantId } }),
    db.design.deleteMany({ where: { tenantId } }),
    db.stockMovement.deleteMany({ where: { tenantId } }),
    db.serviceMaterial.deleteMany({ where: { tenantId } }),
    db.materialBatch.deleteMany({ where: { tenantId } }),
    db.material.deleteMany({ where: { tenantId } }),
    db.reminder.deleteMany({ where: { tenantId } }),
    db.bookingItem.deleteMany({ where: { tenantId } }),
    db.booking.deleteMany({ where: { tenantId } }),
    db.customer.deleteMany({ where: { tenantId } }),
    db.serviceResource.deleteMany({ where: { tenantId } }),
    db.service.deleteMany({ where: { tenantId } }),
    db.serviceCategory.deleteMany({ where: { tenantId } }),
    db.timeOff.deleteMany({ where: { tenantId } }),
    db.payment.deleteMany({ where: { tenantId } }),
    db.auditLog.deleteMany({ where: { tenantId } }),
    db.membership.deleteMany({ where: { tenantId, id: { not: owner.id } } }),
    db.membership.update({ where: { id: owner.id }, data: { resourceId: null, deletedAt: null } }),
    db.resource.deleteMany({ where: { tenantId } }),
    db.tenant.update({ where: { id: tenantId }, data: { ...TENANT, deletedAt: null, settings: { demoResetAt: DateTime.fromJSDate(now).setZone(TZ).toISODate() } } }),
    db.subscription.update({ where: { tenantId }, data: { planId: plan.id, status: 'TRIAL', trialEndsAt: new Date(+now + 14 * 86400_000) } }),
    db.user.update({
      where: { id: owner.userId },
      data: { email: DEMO_EMAIL, name: 'Анна (владелец)', passwordHash, deletedAt: null, failedLoginAttempts: 0, lockedUntil: null, telegramChatId: null, telegramLinkHash: null, phone: null },
    }),
  ]);
  await fillDemo(db, tenantId, owner.userId, now);
  return true;
}

/** Сбрасывать демо раз в сутки, ночью по Москве */
export async function demoResetTick(db: PrismaClient, now = new Date()) {
  const t = await db.tenant.findUnique({ where: { slug: DEMO_SLUG }, select: { settings: true } });
  if (!t) return { reset: 0 };
  const local = DateTime.fromJSDate(now).setZone(TZ);
  if (local.hour < 4) return { reset: 0 };
  if ((t.settings as { demoResetAt?: string } | null)?.demoResetAt === local.toISODate()) return { reset: 0 };
  return { reset: (await resetDemo(db, now)) ? 1 : 0 };
}

/** Наполнение: мастера, услуги, склад, клиенты и записи на сегодня и завтра */
async function fillDemo(db: PrismaClient, tenantId: string, ownerId: string, now = new Date()) {
  const anna = await db.resource.create({ data: { tenantId, name: 'Анна', position: 'Мастер маникюра', schedule: week('10:00', '20:00'), color: '#2F3BFF', sortOrder: 0 } });
  const olga = await db.resource.create({ data: { tenantId, name: 'Ольга', position: 'Бровист', schedule: week('11:00', '19:00'), color: '#FF6F91', sortOrder: 1 } });
  await db.membership.updateMany({ where: { tenantId, userId: ownerId }, data: { resourceId: anna.id } });

  const services = [
    { name: 'Маникюр с покрытием', price: 220000, duration: 120, bufferTime: 10, r: [anna] },
    { name: 'Маникюр без покрытия', price: 120000, duration: 60, bufferTime: 0, r: [anna] },
    { name: 'Коррекция и окрашивание бровей', price: 140000, duration: 45, bufferTime: 0, r: [olga] },
    { name: 'Ламинирование ресниц', price: 250000, duration: 75, bufferTime: 15, r: [olga] },
  ];
  const svc: Record<string, { id: string; name: string; price: number; duration: number; bufferTime: number }> = {};
  for (const [i, { r, ...s }] of services.entries()) {
    const row = await db.service.create({ data: { ...s, tenantId, sortOrder: i } });
    svc[s.name] = row;
    await db.serviceResource.createMany({ data: r.map((x) => ({ tenantId, serviceId: row.id, resourceId: x.id })) });
  }

  // Склад: материалы с партиями и нормами расхода (количества — в тысячных долях единицы)
  const day = (n: number) => new Date(+now + n * 86400_000);
  const stock = [
    { name: 'Гель-лак', unit: 'мл', category: 'Покрытия', minStock: 30, trackExpiry: true, batches: [[20, 90000, 12], [30, 85000, 240]], norms: { 'Маникюр с покрытием': 500 } },
    { name: 'Пилки одноразовые', unit: 'шт', category: 'Расходники', minStock: 50, trackExpiry: false, batches: [[40, 600, null]], norms: { 'Маникюр с покрытием': 1000, 'Маникюр без покрытия': 1000 } },
    { name: 'Краска для бровей', unit: 'мл', category: 'Брови', minStock: 20, trackExpiry: true, batches: [[60, 4000, 150]], norms: { 'Коррекция и окрашивание бровей': 1000 } },
    { name: 'Состав для ламинирования (саше)', unit: 'шт', category: 'Ресницы', minStock: 10, trackExpiry: true, batches: [[24, 35000, 90]], norms: { 'Ламинирование ресниц': 1000 } },
  ] as const;
  for (const m of stock) {
    const total = m.batches.reduce((a, [q]) => a + q * 1000, 0);
    const mat = await db.material.create({
      data: { tenantId, name: m.name, unit: m.unit, category: m.category, minStock: m.minStock * 1000, trackExpiry: m.trackExpiry, stock: total, lastCost: m.batches[0][1] },
    });
    for (const [q, cost, exp] of m.batches) {
      const b = await db.materialBatch.create({ data: { tenantId, materialId: mat.id, qty: q * 1000, remaining: q * 1000, costPerUnit: cost, expiresAt: exp ? day(exp) : null } });
      await db.stockMovement.create({ data: { tenantId, materialId: mat.id, batchId: b.id, type: 'RECEIPT', qty: q * 1000, costPerUnit: cost, note: 'демо-приход' } });
    }
    for (const [name, q] of Object.entries(m.norms)) await db.serviceMaterial.create({ data: { tenantId, serviceId: svc[name].id, materialId: mat.id, qty: q } });
  }

  // Клиенты — с заведомо несуществующими номерами
  const people = [
    { name: 'Мария Иванова', phone: '+79990000101', tags: ['VIP'] },
    { name: 'Екатерина Смирнова', phone: '+79990000102', tags: [] },
    { name: 'Ольга Петрова', phone: '+79990000103', tags: [] },
    { name: 'Наталья Козлова', phone: '+79990000104', tags: ['Новый клиент'] },
  ];
  const customers = [];
  for (const p of people) customers.push(await db.customer.create({ data: { tenantId, ...p } }));

  // Записи, чтобы календарь не был пустым
  const today = DateTime.fromJSDate(now).setZone(TZ).startOf('day');
  const plan: [number, string, string, typeof anna, number, 'CONFIRMED' | 'SCHEDULED'][] = [
    [0, '11:00', 'Маникюр с покрытием', anna, 0, 'CONFIRMED'],
    [0, '14:00', 'Коррекция и окрашивание бровей', olga, 1, 'SCHEDULED'],
    [0, '16:00', 'Маникюр без покрытия', anna, 2, 'SCHEDULED'],
    [1, '12:00', 'Ламинирование ресниц', olga, 3, 'CONFIRMED'],
    [1, '15:00', 'Маникюр с покрытием', anna, 1, 'SCHEDULED'],
  ];
  for (const [d, hhmm, name, r, ci, status] of plan) {
    const s = svc[name];
    const [h, m] = hhmm.split(':').map(Number);
    const startsAt = today.plus({ days: d }).set({ hour: h, minute: m }).toJSDate();
    const endsAt = new Date(+startsAt + s.duration * 60_000);
    await db.booking.create({
      data: {
        tenantId, customerId: customers[ci].id, resourceId: r.id, startsAt, endsAt, blockedUntil: new Date(+endsAt + s.bufferTime * 60_000),
        status, source: ci % 2 ? 'WIDGET' : 'MANUAL', price: s.price,
        items: { create: [{ tenantId, serviceId: s.id, name: s.name, price: s.price, duration: s.duration }] },
      },
    });
  }
}
