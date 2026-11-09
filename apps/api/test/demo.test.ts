import { DateTime } from 'luxon';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoResetTick, DEMO_EMAIL, DEMO_PASSWORD, resetDemo, seedDemo } from '../src/demo/demo';
import { api, closeApp, getApp, resetDb, system } from './helpers';

beforeAll(async () => {
  await resetDb();
  await getApp();
  await seedDemo(system);
});
afterAll(closeApp);

const login = async () => {
  const r = await api().post('/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  expect(r.status).toBe(200);
  return api(r.body.data.accessToken as string);
};

describe('демо-салон с общим входом', () => {
  it('можно пробовать, но нельзя ломать', async () => {
    const d = await login();
    // Пробовать — можно
    expect((await d.get(`/bookings?date=${DateTime.now().setZone('Europe/Moscow').toISODate()}`)).body.data.length).toBe(3);
    expect((await d.post('/services', { name: 'Педикюр', price: 200000, duration: 90 })).status).toBe(201);
    // Ломать — нельзя
    const blocked = [
      await d.post('/me/delete', { password: DEMO_PASSWORD }),
      await d.post('/auth/change-password', { currentPassword: DEMO_PASSWORD, newPassword: 'hacked12345' }),
      await d.post('/team', { email: 'victim@example.com', name: 'X', role: 'ADMIN' }),
      await d.patch('/tenant', { name: 'Плохое слово' }),
      await d.post('/billing/pay', { planCode: 'START', period: 'MONTHLY' }),
    ];
    for (const r of blocked) {
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('DEMO_READONLY');
    }
    expect((await api().get('/public/demo')).body.data.name).toBe('Студия «Лаванда»');
  });

  it('неверный пароль не запирает общий вход', async () => {
    for (let i = 0; i < 7; i++) expect((await api().post('/auth/login', { email: DEMO_EMAIL, password: 'wrong-password' })).status).toBe(401);
    await login();
  });

  it('ночью всё возвращается к исходному', async () => {
    const d = await login();
    const t = await system.tenant.findUniqueOrThrow({ where: { slug: 'demo' } });
    await d.post('/customers', { name: 'Иван Настоящий', phone: '+79161112233' });
    const svc = (await d.get('/services')).body.data[0];
    await d.patch(`/services/${svc.id}`, { name: 'Испорчено' });

    // Днём не сбрасываем, ночью — один раз за сутки
    const night = DateTime.now().setZone('Europe/Moscow').plus({ days: 1 }).set({ hour: 2 }).toJSDate();
    expect((await demoResetTick(system, night)).reset).toBe(0);
    const morning = DateTime.fromJSDate(night).set({ hour: 4, minute: 10 }).toJSDate();
    expect((await demoResetTick(system, morning)).reset).toBe(1);
    expect((await demoResetTick(system, morning)).reset).toBe(0);

    expect(await system.customer.count({ where: { tenantId: t.id, phone: '+79161112233' } })).toBe(0);
    const names = (await system.service.findMany({ where: { tenantId: t.id } })).map((s) => s.name);
    expect(names).toHaveLength(4);
    expect(names).not.toContain('Испорчено');
    expect(await system.booking.count({ where: { tenantId: t.id } })).toBe(5);
    // Вход продолжает работать и после сброса
    expect((await d.get('/auth/me')).status).toBe(200);
    expect(await resetDemo(system)).toBe(true);
  });
});
