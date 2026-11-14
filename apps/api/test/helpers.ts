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
    /** multipart: файл в поле file */
    upload: (url: string, file: string | Buffer, name?: string) => wrap(request(srv).post(`/v1${url}`)).attach('file', file, name),
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

/** Перехват исходящих сообщений Telegram, MAX, ВКонтакте и почты */
export const outbox = {
  telegram: [] as { method: string; body: any }[],
  max: [] as { method: string; path: string; body: any }[],
  vk: [] as { method: string; params: Record<string, string | number> }[],
  email: [] as { to: string; subject: string; text: string }[],
};
export const clearOutbox = () => Object.values(outbox).forEach((a) => (a.length = 0));
type Blocked = () => boolean;
export async function fakeMessengers(opts: { telegramBlocked?: Blocked; maxBlocked?: Blocked; vkBlocked?: Blocked } = {}) {
  const { telegram } = await import('../src/notify/telegram');
  const { max, vk } = await import('../src/notify/channels');
  const { mailer } = await import('../src/notify/mailer');
  telegram.transport = async (method, body) => {
    outbox.telegram.push({ method, body });
    if (method === 'sendMessage' && opts.telegramBlocked?.()) return { ok: false, blocked: true, error: 'Forbidden: bot was blocked by the user' };
    return { ok: true };
  };
  max.transport = async (method, path, body) => {
    outbox.max.push({ method, path, body });
    if (path.startsWith('/messages') && opts.maxBlocked?.()) return { ok: false, status: 403, json: { message: 'chat.denied' } };
    return { ok: true, status: 200, json: {} };
  };
  vk.transport = async (method, params) => {
    outbox.vk.push({ method, params });
    if (method === 'messages.send' && opts.vkBlocked?.()) return { ok: false, json: { error: { error_code: 901, error_msg: "Can't send messages for users without permission" } } };
    return { ok: true, json: { response: 1 } };
  };
  mailer.transport = async (m) => {
    outbox.email.push(m);
    return true;
  };
}
export const maxUpdate = (update: object, secret = 'max-webhook-secret') =>
  api().post('/webhooks/max', update).set('X-Max-Bot-Api-Secret', secret);
export const vkEvent = (event: object, secret = 'vk-secret') => api().post('/webhooks/vk', { secret, group_id: 1, ...event });
export const tgUpdate = (update: object, secret = 'tg-webhook-secret') =>
  api().post('/webhooks/telegram', { update_id: Math.floor(Math.random() * 1e9), ...update }).set('X-Telegram-Bot-Api-Secret-Token', secret);
