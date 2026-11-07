import { DateTime } from 'luxon';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { billingTick } from '../src/billing/billing.service';
import { api, closeApp, createSalon, fakeMessengers, getApp, resetDb, system } from './helpers';

beforeAll(async () => {
  await resetDb();
  await getApp();
  await fakeMessengers();
});
afterAll(closeApp);

describe('подписка: оплата по ссылке', () => {
  it('пробный период → оплата → продление от конца пробного; повторный вебхук ничего не меняет', async () => {
    const s = await createSalon('Pay');
    const sub = (await s.api.get('/billing/subscription')).body.data;
    expect(sub.status).toBe('TRIAL');
    expect(sub.paymentsEnabled).toBe(true);

    const pay = await s.api.post('/billing/pay', { planCode: 'BUSINESS', period: 'MONTHLY' });
    expect(pay.status).toBe(201);
    expect(pay.body.data.amount).toBe(149000);
    expect(pay.body.data.confirmationUrl).toContain(`/pay/mock/${pay.body.data.paymentId}`);
    // Повторное нажатие «Оплатить» — та же ссылка, без дублей
    expect((await s.api.post('/billing/pay', { planCode: 'BUSINESS', period: 'MONTHLY' })).body.data.paymentId).toBe(pay.body.data.paymentId);

    expect((await api().post(`/billing/mock/${pay.body.data.paymentId}/succeed`)).status).toBe(200);
    const after = (await s.api.get('/billing/subscription')).body.data;
    expect(after.status).toBe('ACTIVE');
    expect(after.plan.code).toBe('BUSINESS');
    const expected = DateTime.fromISO(sub.trialEndsAt).plus({ months: 1 }).toMillis();
    expect(Math.abs(+new Date(after.currentPeriodEnd) - expected)).toBeLessThan(5000);

    await api().post(`/billing/mock/${pay.body.data.paymentId}/succeed`);
    expect((await s.api.get('/billing/subscription')).body.data.currentPeriodEnd).toBe(after.currentPeriodEnd);
    expect((await s.api.get(`/billing/payments/${pay.body.data.paymentId}`)).body.data.status).toBe('SUCCEEDED');
  });

  it('просрочка: PAST_DUE (всё работает) → EXPIRED (только чтение, онлайн-запись выключена) → оплата восстанавливает', async () => {
    const s = await createSalon('Expire');
    const now = new Date();
    await system.subscription.update({ where: { tenantId: s.tenantId }, data: { trialEndsAt: new Date(+now - 1000) } });

    await billingTick(system, now);
    expect((await s.api.get('/billing/subscription')).body.data.status).toBe('PAST_DUE');
    expect((await s.api.post('/customers', { name: 'A', phone: '+79991110001' })).status).toBe(201);
    expect((await api().get(`/public/${s.slug}`)).body.data.available).toBe(true);

    await billingTick(system, new Date(+now + 4 * 86400_000));
    expect((await s.api.get('/billing/subscription')).body.data.status).toBe('EXPIRED');
    const blocked = await s.api.post('/customers', { name: 'B', phone: '+79991110002' });
    expect(blocked.status).toBe(402);
    expect(blocked.body.error.code).toBe('SUBSCRIPTION_EXPIRED');
    expect((await s.api.get('/customers')).status).toBe(200);
    expect((await api().get(`/public/${s.slug}`)).body.data.available).toBe(false);

    const pay = await s.api.post('/billing/pay', { planCode: 'START', period: 'YEARLY' });
    expect(pay.body.data.amount).toBe(662400);
    await api().post(`/billing/mock/${pay.body.data.paymentId}/succeed`);
    const sub = (await s.api.get('/billing/subscription')).body.data;
    expect(sub.status).toBe('ACTIVE');
    expect(sub.daysLeft).toBeGreaterThan(360);
    expect((await s.api.post('/customers', { name: 'B', phone: '+79991110002' })).status).toBe(201);
  });

  it('напоминание об оплате владельцу — не чаще раза в сутки', async () => {
    const s = await createSalon('Notice');
    const now = new Date();
    await system.subscription.update({ where: { tenantId: s.tenantId }, data: { trialEndsAt: new Date(+now + 2 * 86400_000) } });
    const r1 = await billingTick(system, now);
    expect(r1.notified).toBeGreaterThanOrEqual(1);
    const sub1 = await system.subscription.findUniqueOrThrow({ where: { tenantId: s.tenantId } });
    expect(sub1.lastNoticeAt).not.toBeNull();
    await billingTick(system, new Date(+now + 3600_000));
    const sub2 = await system.subscription.findUniqueOrThrow({ where: { tenantId: s.tenantId } });
    expect(+sub2.lastNoticeAt!).toBe(+sub1.lastNoticeAt!);
  });

  it('лимит мастеров по тарифу и права на оплату', async () => {
    const s = await createSalon('Limit');
    // Тариф START: до 3 мастеров (владелец уже мастер)
    expect((await s.api.post('/resources', { name: 'Второй' })).status).toBe(201);
    expect((await s.api.post('/resources', { name: 'Третий' })).status).toBe(201);
    const third = await s.api.post('/resources', { name: 'Четвёртый' });
    expect(third.status).toBe(403);
    expect(third.body.error.code).toBe('PLAN_LIMIT');
    expect((await s.api.post('/resources', { name: 'Неактивный', isActive: false })).status).toBe(201);

    const inv = await s.api.post('/team', { email: `adm-${Date.now()}@test.ru`, name: 'Админ', role: 'ADMIN' });
    const login = await api().post('/auth/login', { email: inv.body.data.user.email, password: inv.body.data.tempPassword });
    expect((await api(login.body.data.accessToken).post('/billing/pay', { planCode: 'START' })).status).toBe(403);
  });

  it('вебхук ЮKassa принимается только с IP ЮKassa', async () => {
    const r = await api().post('/webhooks/yookassa', { event: 'payment.succeeded', object: { id: 'x' } });
    expect(r.status).toBe(403);
  });
});
