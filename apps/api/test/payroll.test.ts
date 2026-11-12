import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, closeApp, createSalon, getApp, resetDb, tomorrowAt, tomorrowDate } from './helpers';

beforeAll(async () => {
  await resetDb();
  await getApp();
});
afterAll(closeApp);

describe('зарплата мастеров', () => {
  it('процент от услуг, оплата за смену и оклад; мастер видит только себя', async () => {
    const s = await createSalon('Pay');
    expect((await s.api.put(`/payroll/rules/${s.resourceId}`, { percent: 40, perShift: 50000, monthly: 3000000, deductMaterials: false })).status).toBe(200);
    const c = await s.api.post('/customers', { name: 'Клиент', phone: '+79990002233' });
    for (const t of ['10:00', '12:00']) {
      const b = await s.api.post('/bookings', { customerId: c.body.data.id, resourceId: s.resourceId, serviceIds: [s.serviceId], startsAt: tomorrowAt(t) });
      expect((await s.api.post(`/bookings/${b.body.data.id}/status`, { status: 'COMPLETED', version: b.body.data.version })).status).toBe(201);
    }
    // Отменённая не считается
    const x = await s.api.post('/bookings', { customerId: c.body.data.id, resourceId: s.resourceId, serviceIds: [s.serviceId], startsAt: tomorrowAt('15:00') });
    await s.api.post(`/bookings/${x.body.data.id}/status`, { status: 'CANCELLED', version: x.body.data.version });

    const to = tomorrowDate(); const from = tomorrowDate(-28);
    const r = (await s.api.get(`/payroll?from=${from}&to=${to}`)).body.data;
    expect(r.days).toBe(30);
    expect(r.masters[0]).toMatchObject({ visits: 2, revenue: 300000, shifts: 1, fromPercent: 120000, fromShifts: 50000, fromMonthly: 3000000, total: 3170000 });
    expect(r.total).toBe(3170000);

    // Мастер без права на деньги видит только свой расчёт и не меняет правила
    const m2 = await s.api.post('/resources', { name: 'Ольга', schedule: { '1': [['10:00', '20:00']] } });
    const inv = await s.api.post('/team', { email: `pay-${Date.now()}@test.ru`, name: 'Ольга', role: 'MASTER', resourceId: m2.body.data.id });
    const login = await api().post('/auth/login', { email: inv.body.data.user.email, password: inv.body.data.tempPassword });
    const master = api(login.body.data.accessToken);
    const own = (await master.get(`/payroll?from=${from}&to=${to}`)).body.data;
    expect(own.masters.map((m: any) => m.name)).toEqual(['Ольга']);
    expect((await master.put(`/payroll/rules/${m2.body.data.id}`, { percent: 100 })).status).toBe(403);
  });
});
