import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oauth } from '../src/client/oauth';
import { env } from '../src/config';
import { api, clearOutbox, closeApp, createSalon, fakeMessengers, getApp, outbox, resetDb, system, tomorrowAt, tomorrowDate } from './helpers';

let srv: any;
beforeAll(async () => {
  await resetDb();
  srv = (await getApp()).getHttpServer();
  await fakeMessengers();
  env.SMTP_URL = env.SMTP_URL ?? 'smtp://test';
});
afterAll(closeApp);

/** «Браузер» клиента: хранит cookie между запросами */
function browser() {
  const agent = request.agent(srv);
  const x = (r: request.Test) => r.set('X-Requested-With', 'x');
  return {
    get: (u: string) => agent.get(`/v1${u}`),
    post: (u: string, b: object = {}) => x(agent.post(`/v1${u}`)).send(b),
    del: (u: string) => x(agent.delete(`/v1${u}`)),
  };
}
const linkFrom = (text: string, path: string) => text.match(new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`))![1];

describe('кабинет клиента', () => {
  it('регистрация, подтверждение почты, записи из разных салонов, восстановление пароля, удаление', async () => {
    const a = await createSalon('Салон А');
    const b = await createSalon('Салон Б');
    const c = browser();
    clearOutbox();
    expect((await c.post('/client/register', { name: 'Ира', email: 'ira@example.ru', password: 'password1', consent: false })).status).toBe(400);
    const reg = await c.post('/client/register', { name: 'Ира', email: 'ira@example.ru', password: 'password1', consent: true });
    expect(reg.status).toBe(201);
    expect(reg.body.data).toMatchObject({ email: 'ira@example.ru', emailVerified: false });
    expect((await c.post('/client/register', { name: 'X', email: 'ira@example.ru', password: 'password2', consent: true })).status).toBe(409);

    // Записалась в салон А, будучи в кабинете
    const slot = (await c.get(`/public/${a.slug}/slots?date=${tomorrowDate(2)}&serviceIds=${a.serviceId}`)).body.data[0].slots[0];
    expect((await c.post(`/public/${a.slug}/book`, { serviceIds: [a.serviceId], resourceId: null, startsAt: slot, name: 'Ира', phone: '+79991230001', consent: true })).status).toBe(201);
    // В салон Б её записал администратор по email — появится после подтверждения почты
    const cust = await b.api.post('/customers', { name: 'Ирина', phone: '+79991230002', email: 'ira@example.ru' });
    await b.api.post('/bookings', { customerId: cust.body.data.id, resourceId: b.resourceId, serviceIds: [b.serviceId], startsAt: tomorrowAt('12:00') });

    expect((await c.get('/client/bookings')).body.data.map((x: any) => x.salon.name)).toEqual(['Салон А']);
    const verifyToken = linkFrom(outbox.email.find((m) => m.to === 'ira@example.ru')!.text, '/account/verify');
    expect((await c.post('/client/verify', { token: verifyToken })).status).toBe(200);
    const list = (await c.get('/client/bookings')).body.data;
    expect(list.map((x: any) => x.salon.name).sort()).toEqual(['Салон А', 'Салон Б']);
    // Ссылка «управлять записью» из кабинета работает
    expect((await api().get(`/public/${list[0].slug}/manage/${list[0].token}`)).status).toBe(200);

    // Выход и вход; неверный пароль
    await c.post('/client/logout');
    expect((await c.get('/client/me')).status).toBe(401);
    expect((await c.post('/client/login', { email: 'ira@example.ru', password: 'wrong-pass' })).status).toBe(401);
    expect((await c.post('/client/login', { email: 'ira@example.ru', password: 'password1' })).status).toBe(200);

    // Восстановление пароля: старая сессия перестаёт действовать
    const other = browser();
    clearOutbox();
    expect((await other.post('/client/forgot', { email: 'nobody@example.ru' })).status).toBe(200);
    expect(outbox.email).toHaveLength(0);
    await other.post('/client/forgot', { email: 'ira@example.ru' });
    const resetToken = linkFrom(outbox.email[0].text, '/account/reset');
    expect((await other.post('/client/reset', { token: resetToken, password: 'new-password-1' })).status).toBe(200);
    expect((await c.get('/client/me')).status).toBe(401);
    expect((await other.post('/client/reset', { token: resetToken, password: 'again-password' })).status).toBe(400);
    expect((await c.post('/client/login', { email: 'ira@example.ru', password: 'new-password-1' })).status).toBe(200);

    // Ручной телефон не подтверждён — по нему чужие записи не подтягиваются
    await c.post('/client/profile', { phone: '+7 999 123-00-02' });
    expect((await c.get('/client/me')).body.data).toMatchObject({ phone: '+79991230002', phoneVerified: false });

    // Удаление аккаунта: записи у салонов остаются
    expect((await c.del('/client/me')).status).toBe(200);
    expect(await system.clientUser.count({ where: { email: 'ira@example.ru' } })).toBe(0);
    expect(await system.booking.count({ where: { tenantId: a.tenantId } })).toBe(1);
  });

  it('привязка записей с устройства и вход через Яндекс ID', async () => {
    const s = await createSalon('Салон В');
    const pub = api();
    const slot = (await pub.get(`/public/${s.slug}/slots?date=${tomorrowDate(2)}&serviceIds=${s.serviceId}`)).body.data[0].slots[0];
    const bk = await pub.post(`/public/${s.slug}/book`, { serviceIds: [s.serviceId], resourceId: null, startsAt: slot, name: 'Оля', phone: '+79995550099', consent: true });

    // Вход через Яндекс: подменяем обмен кода на профиль
    env.YANDEX_CLIENT_ID = 'yid'; env.YANDEX_CLIENT_SECRET = 'ysecret';
    oauth.profile = async () => ({ id: 'y-1', email: 'olya@yandex.ru', name: 'Ольга', phone: '+79995550099' });
    expect((await request(srv).get('/v1/client/config')).body.data.providers).toEqual(['yandex']);
    // VK ID убран — такой адрес больше не работает
    expect((await request(srv).get('/v1/client/oauth/vk/start')).status).toBe(404);

    const c = request.agent(srv);
    const start = await c.get('/v1/client/oauth/yandex/start?consent=1');
    expect(start.status).toBe(302);
    const url = new URL(start.headers.location);
    expect(url.host).toBe('oauth.yandex.ru');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    // Подделанный state — отказ
    expect((await c.get(`/v1/client/oauth/yandex/callback?code=x&state=bad`)).headers.location).toContain('/account/login?error=');
    const start2 = await c.get('/v1/client/oauth/yandex/start?consent=1');
    const cb = await c.get(`/v1/client/oauth/yandex/callback?code=abc&state=${new URL(start2.headers.location).searchParams.get('state')}`);
    expect(cb.headers.location).toMatch(/\/my$/);
    // Телефон подтверждён Яндексом — запись, сделанная без входа, уже в кабинете
    const mine = (await c.get('/v1/client/bookings')).body.data;
    expect(mine.map((x: any) => x.salon.name)).toEqual(['Салон В']);

    expect((await c.get('/v1/client/me')).body.data).toMatchObject({ email: 'olya@yandex.ru', yandex: true });
    expect(await system.clientUser.count({ where: { email: 'olya@yandex.ru' } })).toBe(1);

    // Новый человек без согласия — аккаунт не создаётся
    oauth.profile = async () => ({ id: 'y-2', email: 'new@yandex.ru', name: 'Новый', phone: null });
    const n = request.agent(srv);
    const ns = await n.get('/v1/client/oauth/yandex/start');
    const ncb = await n.get(`/v1/client/oauth/yandex/callback?code=c&state=${new URL(ns.headers.location).searchParams.get('state')}`);
    expect(decodeURIComponent(ncb.headers.location)).toContain('согласие');
    expect(await system.clientUser.count({ where: { yandexId: 'y-2' } })).toBe(0);

    // Привязка ссылки с устройства: другой клиент по паролю
    const p = browser();
    await p.post('/client/register', { name: 'Петя', email: 'petya@example.ru', password: 'password1', consent: true });
    const claim = await p.post('/client/claim', { refs: [{ slug: s.slug, token: bk.body.data.manageToken }, { slug: s.slug, token: 'bad-token-0000000000' }] });
    // Привязалась только эта запись (ссылка на неё у Пети и так была), а не вся история клиента в салоне
    expect(claim.body.data.linked).toBe(1);
    const petya = (await p.get('/client/bookings')).body.data;
    expect(petya).toHaveLength(1);
    expect((await system.customer.findFirstOrThrow({ where: { phone: '+79995550099' } })).clientUserId).toBeNull();

    // Записавшись из кабинета на чужой номер, нельзя увидеть другие визиты владельца номера
    const victimBooking = await s.api.post('/bookings', { customerId: (await system.customer.findFirstOrThrow({ where: { phone: '+79995550099' } })).id, resourceId: s.resourceId, serviceIds: [s.serviceId], startsAt: tomorrowAt('18:00') });
    expect(victimBooking.status).toBe(201);
    const slot2 = (await p.get(`/public/${s.slug}/slots?date=${tomorrowDate(3)}&serviceIds=${s.serviceId}`)).body.data[0].slots[0];
    await p.post(`/public/${s.slug}/book`, { serviceIds: [s.serviceId], resourceId: null, startsAt: slot2, name: 'Петя', phone: '+79995550099', consent: true });
    expect((await p.get('/client/bookings')).body.data).toHaveLength(2);
  });
});
