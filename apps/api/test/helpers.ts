import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';
import request from 'supertest';
import { seedPlans } from '../prisma/seed';
import { createApp } from '../src/bootstrap';

export const system = new PrismaClient({ datasourceUrl: process.env.SYSTEM_DATABASE_URL });

export async function resetDb() {
  const tables = await system.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations')`;
  await system.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
  await seedPlans(system);
}

let app: INestApplication;
export async function getApp() {
  if (!app) {
    app = await createApp();
    await app.init();
  }
  return app;
}
export async function closeApp() {
  await app?.close();
  await system.$disconnect();
}

/** Клиент API с Bearer-токеном (как мобильное приложение). */
export function api(token?: string) {
  const srv = app.getHttpServer();
  const wrap = (r: request.Test) => {
    r.set('X-Client', 'mobile');
    if (token) r.set('Authorization', `Bearer ${token}`);
    return r;
  };
  return {
    get: (url: string) => wrap(request(srv).get(`/v1${url}`)),
    post: (url: string, body?: object) => wrap(request(srv).post(`/v1${url}`)).send(body ?? {}),
    patch: (url: string, body?: object) => wrap(request(srv).patch(`/v1${url}`)).send(body ?? {}),
    put: (url: string, body?: object) => wrap(request(srv).put(`/v1${url}`)).send(body ?? {}),
    delete: (url: string) => wrap(request(srv).delete(`/v1${url}`)),
  };
}

let n = 0;
/** Зарегистрировать салон с мастером и услугой (60 мин + 15 мин перерыв). */
export async function createSalon(name = 'Salon') {
  n += 1;
  const slug = `salon-${n}-${Date.now() % 100000}`;
  const reg = await api().post('/auth/register', {
    email: `owner${n}-${Date.now()}@test.ru`, password: 'password123', name: `Owner ${name}`,
    salonName: name, slug, timezone: 'Europe/Moscow', acceptTerms: true, acceptPrivacy: true,
  });
  if (reg.status !== 201) throw new Error(JSON.stringify(reg.body));
  const token = reg.body.data.accessToken as string;
  const a = api(token);
  const me = await a.get('/auth/me');
  const resourceId = me.body.data.resourceId as string;
  // Мастер работает каждый день 10–20, чтобы тесты не зависели от дня недели.
  const all = Object.fromEntries(['1', '2', '3', '4', '5', '6', '7'].map((d) => [d, [['10:00', '20:00']]]));
  await a.patch(`/resources/${resourceId}`, { schedule: all });
  const svc = await a.post('/services', { name: 'Стрижка', price: 150000, duration: 60, bufferTime: 15 });
  return { slug, token, api: a, resourceId, serviceId: svc.body.data.id as string, tenantId: reg.body.data.tenant.id as string, refreshToken: reg.body.data.refreshToken as string };
}

/** Завтра в HH:MM по Москве → ISO UTC */
export const tomorrowAt = (hhmm: string, plusDays = 1) => {
  const [h, m] = hhmm.split(':').map(Number);
  return DateTime.now().setZone('Europe/Moscow').plus({ days: plusDays }).set({ hour: h, minute: m, second: 0, millisecond: 0 }).toUTC().toISO()!;
};
export const tomorrowDate = (plusDays = 1) => DateTime.now().setZone('Europe/Moscow').plus({ days: plusDays }).toISODate()!;

/** Перехват исходящих сообщений Telegram и SMS */
export const outbox = { telegram: [] as { method: string; body: any }[], sms: [] as { phone: string; text: string }[] };
export async function fakeMessengers(opts: { telegramBlocked?: () => boolean } = {}) {
  const { telegram } = await import('../src/notify/telegram');
  const { sms } = await import('../src/notify/sms');
  telegram.transport = async (method, body) => {
    outbox.telegram.push({ method, body });
    if (method === 'sendMessage' && opts.telegramBlocked?.()) return { ok: false, blocked: true, error: 'Forbidden: bot was blocked by the user' };
    return { ok: true };
  };
  sms.transport = async (phone, text) => {
    outbox.sms.push({ phone, text });
    return { ok: true, id: 'sms-1' };
  };
}
export const tgUpdate = (update: object, secret = 'tg-webhook-secret') =>
  api().post('/webhooks/telegram', { update_id: Math.floor(Math.random() * 1e9), ...update }).set('X-Telegram-Bot-Api-Secret-Token', secret);
