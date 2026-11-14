import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { purgeDeletedTenants } from '../src/auth/account.controller';
import { mailer } from '../src/notify/mailer';
import { push } from '../src/notify/push';
import { api, closeApp, createSalon, fakeMessengers, getApp, resetDb, system, tomorrowAt } from './helpers';

const mails: { to: string; text: string }[] = [];
const pushes: { to: string; title: string; data?: Record<string, string> }[] = [];

beforeAll(async () => {
  await resetDb();
  await getApp();
  await fakeMessengers();
  mailer.transport = async (m) => { mails.push(m); return true; };
  push.transport = async (msgs) => {
    pushes.push(...msgs);
    return msgs.map((m) => (m.to.includes('dead') ? { status: 'error' as const, details: { error: 'DeviceNotRegistered' } } : { status: 'ok' as const }));
  };
});
afterAll(closeApp);

const emailOf = async (token: string) => (await api(token).get('/auth/me')).body.data.user.email as string;

describe('восстановление пароля', () => {
  it('письмо со ссылкой → новый пароль → старые сессии отозваны; ссылка одноразовая', async () => {
    const s = await createSalon('Reset');
    const email = await emailOf(s.token);
    // Неизвестный email — тот же ответ, письма нет
    expect((await api().post('/auth/forgot', { email: 'nobody@test.ru' })).status).toBe(200);
    expect(mails).toHaveLength(0);

    await api().post('/auth/forgot', { email });
    expect(mails).toHaveLength(1);
    const token = new URL(mails[0].text.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;

    expect((await api().post('/auth/reset', { token, password: 'short' })).status).toBe(400);
    expect((await api().post('/auth/reset', { token, password: 'new-password-1' })).status).toBe(200);
    expect((await api().post('/auth/reset', { token, password: 'new-password-2' })).body.error.code).toBe('RESET_INVALID');

    expect((await api().post('/auth/refresh', { refreshToken: s.refreshToken })).status).toBe(401);
    expect((await api().post('/auth/login', { email, password: 'password123' })).status).toBe(401);
    expect((await api().post('/auth/login', { email, password: 'new-password-1' })).status).toBe(200);
  });
});

describe('push-уведомления', () => {
  it('новая онлайн-запись → push владельцу; токены удалённых приложений чистятся', async () => {
    const s = await createSalon('Push');
    expect((await s.api.post('/me/push-tokens', { token: 'not-a-token', platform: 'ios' })).status).toBe(400);
    await s.api.post('/me/push-tokens', { token: 'ExponentPushToken[ok-1]', platform: 'ios' });
    await s.api.post('/me/push-tokens', { token: 'ExponentPushToken[dead-1]', platform: 'android' });

    const startsAt = tomorrowAt('12:00', 2);
    const r = await api().post(`/public/${s.slug}/book`, { serviceIds: [s.serviceId], resourceId: null, startsAt, name: 'Пуш', phone: '+79995550101', consent: true });
    expect(r.status).toBe(201);
    await new Promise((x) => setTimeout(x, 300));
    const got = pushes.filter((p) => p.to.startsWith('ExponentPushToken'));
    expect(got.map((p) => p.to).sort()).toEqual(['ExponentPushToken[dead-1]', 'ExponentPushToken[ok-1]']);
    expect(got[0].title).toBe('Новая онлайн-запись');
    expect(got[0].data?.bookingId).toBe(r.body.data.id);
    expect(await system.pushToken.count({ where: { token: 'ExponentPushToken[dead-1]' } })).toBe(0);
  });
});

describe('удаление аккаунта и выгрузка', () => {
  it('выгрузка клиентов в CSV (с защитой от формул)', async () => {
    const s = await createSalon('Export');
    await s.api.post('/customers', { name: '=HYPERLINK("x")', phone: '+79990002001', tags: ['VIP'] });
    const r = await s.api.get('/tenant/export/customers.csv');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.text).toContain('"\'=HYPERLINK(""x"")"');
    expect(r.text).toContain('"+79990002001"');
  });

  it('владелец удаляет аккаунт: вход и онлайн-запись закрыты, сотрудники теряют доступ, через 30 дней данные стёрты', async () => {
    const s = await createSalon('Delete');
    const email = await emailOf(s.token);
    await s.api.post('/customers', { name: 'Клиент', phone: '+79990003001' });
    const inv = await s.api.post('/team', { email: `adm-del-${Date.now()}@test.ru`, name: 'Админ', role: 'ADMIN' });
    const admin = await api().post('/auth/login', { email: inv.body.data.user.email, password: inv.body.data.tempPassword });

    expect((await s.api.post('/me/delete', { password: 'wrong' })).status).toBe(400);
    expect((await s.api.post('/me/delete', { password: 'password123' })).status).toBe(200);

    expect((await api().post('/auth/login', { email, password: 'password123' })).status).toBe(401);
    // Ещё не истёкшие токены владельца и сотрудника сразу перестают работать
    expect((await s.api.get('/auth/me')).status).toBe(401);
    expect((await api(admin.body.data.accessToken).get('/bookings')).status).toBe(401);
    expect((await api().get(`/public/${s.slug}`)).status).toBe(404);
    // Адрес страницы освободился сразу
    expect((await api().get(`/auth/check-slug?slug=${s.slug}`)).body.data.available).toBe(true);
    expect((await api().post('/auth/refresh', { refreshToken: admin.body.data.refreshToken })).status).toBe(401);
    // Email освободился — можно зарегистрироваться заново
    expect((await api().post('/auth/register', { email, password: 'password123', name: 'Снова', salonName: 'Новый салон', slug: `again-${Date.now() % 100000}`, acceptTerms: true, acceptPrivacy: true })).status).toBe(201);

    expect((await purgeDeletedTenants(system, new Date())).purged).toBe(0);
    await purgeDeletedTenants(system, new Date(Date.now() + 31 * 86400_000));
    expect(await system.customer.count({ where: { tenantId: s.tenantId } })).toBe(0);
    const t = await system.tenant.findUniqueOrThrow({ where: { id: s.tenantId } });
    expect(t.name).toBe('Удалённый салон');
  });
});

describe('вход с кодом', () => {
  it('после пароля нужен код из письма; 5 ошибок — код сгорает', async () => {
    const { clearOutbox, fakeMessengers, outbox } = await import('./helpers');
    await fakeMessengers();
    const { env } = await import('../src/config');
    const prev = env.SMTP_URL;
    env.SMTP_URL = 'smtp://test';
    try {
      const s = await createSalon('TwoFactor');
      const me = (await s.api.get('/auth/me')).body.data;
      expect(me.twoFactor).toEqual({ enabled: false, channels: ['email'] });
      expect((await s.api.post('/auth/two-factor', { enabled: true, password: 'wrong' })).status).toBe(400);
      expect((await s.api.post('/auth/two-factor', { enabled: true, password: 'password123' })).status).toBe(200);

      clearOutbox();
      const step1 = await api().post('/auth/login', { email: me.user.email, password: 'password123' });
      expect(step1.status).toBe(200);
      expect(step1.body.data.accessToken).toBeUndefined();
      const { challenge, sentTo } = step1.body.data.twoFactor;
      expect(sentTo).toMatch(/\*\*\*@test\.ru$/);
      const code = outbox.email.at(-1)!.subject.match(/\d{6}/)![0];

      expect((await api().post('/auth/login/code', { challenge, code: code === '000000' ? '111111' : '000000' })).status).toBe(401);
      const ok = await api().post('/auth/login/code', { challenge, code });
      expect(ok.status).toBe(200);
      expect(ok.body.data.accessToken).toBeTruthy();
      // Код одноразовый
      expect((await api().post('/auth/login/code', { challenge, code })).status).toBe(401);

      // 5 ошибок — код сгорает даже для верного кода
      const again = (await api().post('/auth/login', { email: me.user.email, password: 'password123' })).body.data.twoFactor;
      const good = outbox.email.at(-1)!.subject.match(/\d{6}/)![0];
      const bad = good === '123456' ? '654321' : '123456';
      for (let i = 0; i < 5; i++) await api().post('/auth/login/code', { challenge: again.challenge, code: bad });
      expect((await api().post('/auth/login/code', { challenge: again.challenge, code: good })).status).toBe(401);
    } finally {
      env.SMTP_URL = prev;
    }
  });
});

describe('вход сотрудников через Яндекс ID', () => {
  it('новый — на регистрацию с билетом; существующий по email — вход; мобильное приложение — билет; код входа не обходится', async () => {
    const request = (await import('supertest')).default;
    const { oauth } = await import('../src/client/oauth');
    const { env } = await import('../src/config');
    const { getApp } = await import('./helpers');
    const srv = (await getApp()).getHttpServer();
    env.YANDEX_CLIENT_ID = 'yid'; env.YANDEX_CLIENT_SECRET = 'ys';
    const flow = async (p: 'yandex', mobile = false) => {
      const ag = request.agent(srv);
      const s = await ag.get(`/v1/auth/oauth/${p}/start${mobile ? '?mobile=1' : ''}`);
      expect(s.status).toBe(302);
      expect(new URL(s.headers.location).searchParams.get('redirect_uri')).toContain('/v1/auth/oauth/');
      const cb = await ag.get(`/v1/auth/oauth/${p}/callback?code=c&state=${new URL(s.headers.location).searchParams.get('state')}`);
      return { ag, loc: cb.headers.location as string, cookies: cb.headers['set-cookie'] as unknown as string[] | undefined };
    };

    // 1. Новый человек: на регистрацию; регистрируется без пароля, email берётся из Яндекса
    oauth.profile = async () => ({ id: 'staff-y-1', email: 'yandex-owner@ya.ru', name: 'Вера Яндекс', phone: null });
    const r1 = await flow('yandex');
    expect(r1.loc).toContain('/register?');
    const ticket = new URL(r1.loc).searchParams.get('oauth')!;
    const reg = await api().post('/auth/register', {
      oauthTicket: ticket, email: 'evil@x.ru', name: 'Вера Яндекс', kind: 'solo', timezone: 'Europe/Moscow', acceptTerms: true, acceptPrivacy: true,
    });
    expect(reg.status).toBe(201);
    expect(reg.body.data.user.email).toBe('yandex-owner@ya.ru');
    // Билет одноразовый
    expect((await api().post('/auth/register', { oauthTicket: ticket, email: 'a@b.ru', name: 'X', kind: 'solo', timezone: 'Europe/Moscow', acceptTerms: true, acceptPrivacy: true })).status).toBe(400);

    // 2. Повторный вход: сразу в приложение с cookie-сессией
    const r2 = await flow('yandex');
    expect(r2.loc).toMatch(/\/$/);
    expect(r2.cookies?.some((c) => c.startsWith('access_token='))).toBe(true);

    // 3. Существующий владелец по паролю входит через Яндекс ID с тем же email; мобильное приложение — билет
    const s = await createSalon('VkLogin');
    const email = (await s.api.get('/auth/me')).body.data.user.email;
    oauth.profile = async () => ({ id: 'staff-y-2', email, name: 'Владелец', phone: null });
    expect((await request(srv).get('/v1/auth/oauth/vk/start')).status).toBe(404);
    const r3 = await flow('yandex', true);
    expect(r3.loc).toMatch(/^mioflow:\/\/oauth\?ticket=/);
    const ex = await api().post('/auth/oauth/exchange', { ticket: new URL(r3.loc.replace('mioflow://', 'https://x/')).searchParams.get('ticket') });
    expect(ex.status).toBe(200);
    expect(ex.body.data.accessToken).toBeTruthy();

    // 4. Включён вход с кодом — Яндекс ID его не обходит
    await system.user.update({ where: { email }, data: { twoFactorEnabled: true } });
    const prevSmtp = env.SMTP_URL; env.SMTP_URL = 'smtp://test';
    const r4 = await flow('yandex');
    env.SMTP_URL = prevSmtp;
    expect(r4.loc).toContain('/login?tf=');
    expect(r4.cookies?.some((c) => c.startsWith('access_token='))).toBeFalsy();
  });
});
