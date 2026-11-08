import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, closeApp, createSalon, getApp, resetDb, system, tomorrowAt } from './helpers';

beforeAll(async () => {
  await resetDb();
  await getApp();
});
afterAll(closeApp);

async function invite(s: Awaited<ReturnType<typeof createSalon>>, role: string, resourceId?: string) {
  const inv = await s.api.post('/team', { email: `${role.toLowerCase()}-${Date.now()}-${Math.random()}@test.ru`, name: role, role, resourceId });
  expect(inv.status).toBe(201);
  const login = await api().post('/auth/login', { email: inv.body.data.user.email, password: inv.body.data.tempPassword });
  return { id: inv.body.data.id as string, api: api(login.body.data.accessToken as string) };
}

describe('роли и доступы', () => {
  it('мастер видит только свои записи и своих клиентов; владелец настраивает доступ', async () => {
    const s = await createSalon('Roles');
    const m2 = await s.api.post('/resources', { name: 'Ольга', schedule: { '1': [['10:00', '20:00']], '2': [['10:00', '20:00']], '3': [['10:00', '20:00']], '4': [['10:00', '20:00']], '5': [['10:00', '20:00']], '6': [['10:00', '20:00']], '7': [['10:00', '20:00']] } });
    await system.serviceResource.createMany({ data: [{ tenantId: s.tenantId, serviceId: s.serviceId, resourceId: m2.body.data.id }], skipDuplicates: true });
    await s.api.post('/bookings', { customer: { name: 'Клиент владельца', phone: '+79991110001' }, resourceId: s.resourceId, serviceIds: [s.serviceId], startsAt: tomorrowAt('12:00') });
    const mine = await s.api.post('/bookings', { customer: { name: 'Клиент Ольги', phone: '+79991110002' }, resourceId: m2.body.data.id, serviceIds: [s.serviceId], startsAt: tomorrowAt('12:00') });
    expect(mine.status).toBe(201);

    const master = await invite(s, 'MASTER', m2.body.data.id);
    const me = (await master.api.get('/auth/me')).body.data;
    expect(me.permissions).toEqual(['customers.contacts']);

    const list = await master.api.get(`/bookings?from=${tomorrowAt('00:00')}&to=${tomorrowAt('23:59')}`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((b: any) => b.customer.name)).toEqual(['Клиент Ольги']);

    const cust = await master.api.get('/customers');
    expect(cust.body.data.map((c: any) => c.name)).toEqual(['Клиент Ольги']);
    expect(cust.body.data[0].phone).toBe('+79991110002');
    const other = await system.customer.findFirstOrThrow({ where: { phone: '+79991110001' } });
    expect((await master.api.get(`/customers/${other.id}`)).status).toBe(404);

    // Закрытые разделы
    expect((await master.api.get('/analytics/summary')).status).toBe(403);
    expect((await master.api.post('/services', { name: 'X', price: 1, duration: 30 })).status).toBe(403);
    expect((await master.api.put('/tenant/permissions', { permissions: { MASTER: { 'bookings.all': true } } })).status).toBe(403);

    // Владелец скрывает контакты от мастеров
    const matrix = await s.api.put('/tenant/permissions', { permissions: { MASTER: { 'customers.contacts': false } } });
    expect(matrix.status).toBe(200);
    expect(matrix.body.data.roles.find((r: any) => r.role === 'MASTER').granted).toEqual([]);
    const masked = await master.api.get('/customers');
    expect(masked.body.data[0].phone).toBe('+7 *** ***-00-02');
    const b = (await master.api.get(`/bookings/${mine.body.data.id}`)).body.data;
    expect(b.customer.phone).toBe('+7 *** ***-00-02');
    // Попытка сменить телефон без права — игнорируется
    await master.api.patch(`/customers/${b.customer.id}`, { phone: '+79990000000', notes: 'Любит кофе' });
    const after = await system.customer.findUniqueOrThrow({ where: { id: b.customer.id } });
    expect(after).toMatchObject({ phone: '+79991110002', notes: 'Любит кофе' });

    // ...и открывает мастеру все записи
    await s.api.put('/tenant/permissions', { permissions: { MASTER: { 'bookings.all': true } } });
    const all = await master.api.get(`/bookings?from=${tomorrowAt('00:00')}&to=${tomorrowAt('23:59')}`);
    expect(all.body.data).toHaveLength(2);

    // Права нельзя поменять через общие настройки салона
    await s.api.patch('/tenant', { settings: { permissions: { MASTER: { 'analytics.view': true } }, cancelBeforeHours: 5 } });
    const t = (await s.api.get('/tenant')).body.data;
    expect(t.settings.cancelBeforeHours).toBe(5);
    expect(t.settings.permissions.MASTER['analytics.view']).toBeUndefined();
    // Частичное обновление не сбрасывает остальные настройки
    await s.api.patch('/tenant', { settings: { about: 'О салоне' } });
    expect((await s.api.get('/tenant')).body.data.settings).toMatchObject({ cancelBeforeHours: 5, about: 'О салоне' });
  });

  it('только владелец назначает управляющего; нельзя менять владельца и себя', async () => {
    const s = await createSalon('Team');
    const manager = await invite(s, 'MANAGER');
    const adm = await manager.api.post('/team', { email: `a-${Date.now()}@test.ru`, name: 'Админ', role: 'ADMIN' });
    expect(adm.status).toBe(201);
    expect((await manager.api.post('/team', { email: `m-${Date.now()}@test.ru`, name: 'М', role: 'MANAGER' })).status).toBe(403);
    expect((await manager.api.patch(`/team/${adm.body.data.id}`, { role: 'MANAGER' })).status).toBe(403);
    expect((await manager.api.patch(`/team/${adm.body.data.id}`, { role: 'MASTER', resourceId: s.resourceId })).status).toBe(200);
    expect((await manager.api.patch(`/team/${manager.id}`, { role: 'ADMIN' })).status).toBe(403);
    const owner = (await s.api.get('/team')).body.data.find((m: any) => m.role === 'OWNER');
    expect((await manager.api.patch(`/team/${owner.id}`, { role: 'ADMIN' })).status).toBe(403);
    expect((await manager.api.delete(`/team/${owner.id}`)).status).toBe(403);

    // Администратор по умолчанию не управляет командой и не видит отчёты
    const admin = await invite(s, 'ADMIN');
    expect((await admin.api.get('/team')).status).toBe(403);
    expect((await admin.api.get('/analytics/summary')).status).toBe(403);
    expect((await admin.api.get('/tenant/export/customers.csv')).status).toBe(403);
  });

  it('кабинет владельца: выручка, источники (Яндекс Карты), загрузка мастеров', async () => {
    const s = await createSalon('Stats');
    const startsAt = tomorrowAt('12:00');
    const r = await api().post(`/public/${s.slug}/book`, { serviceIds: [s.serviceId], resourceId: null, startsAt, name: 'С карт', phone: '+79992220001', consent: true, ref: 'yandex' });
    expect(r.status).toBe(201);
    const done = await s.api.post('/bookings', { customer: { name: 'Пришла', phone: '+79992220002' }, resourceId: s.resourceId, serviceIds: [s.serviceId], startsAt: tomorrowAt('15:00') });
    await system.booking.update({ where: { id: done.body.data.id }, data: { status: 'COMPLETED' } });

    const sum = await s.api.get(`/analytics/summary?to=${new Date(Date.now() + 86400_000 * 2).toISOString().slice(0, 10)}`);
    expect(sum.status).toBe(200);
    const d = sum.body.data;
    expect(d.totals).toMatchObject({ bookings: 2, completed: 1, revenue: 150000, booked: 300000, avgCheck: 150000, newCustomers: 2 });
    expect(d.totals.onlineShare).toBe(0.5);
    expect(d.sources.map((x: any) => x.label).sort()).toEqual(['Администратор', 'Яндекс Карты']);
    expect(d.masters[0]).toMatchObject({ bookings: 2, bookedMin: 120 });
    expect(d.masters[0].load).toBeGreaterThan(0);
    expect(d.services[0]).toMatchObject({ name: 'Стрижка', count: 2 });
    expect((await s.api.get('/analytics/summary?from=2020-01-01&to=2026-01-01')).status).toBe(400);
  });
});

describe('карточки «Сегодня»', () => {
  it('загрузка, ожидаемый доход и лучший мастер; мастеру недоступно', async () => {
    const { DateTime } = await import('luxon');
    const s = await createSalon('Today');
    const day = DateTime.now().setZone('Europe/Moscow').startOf('day');
    const c = await system.customer.create({ data: { tenantId: s.tenantId, name: 'Сегодняшний', phone: '+79993330001' } });
    const at = (h: number) => day.set({ hour: h }).toJSDate();
    await system.booking.create({ data: { tenantId: s.tenantId, customerId: c.id, resourceId: s.resourceId, startsAt: at(10), endsAt: at(12), blockedUntil: at(12), price: 300000, status: 'COMPLETED' } });
    await system.booking.create({ data: { tenantId: s.tenantId, customerId: c.id, resourceId: s.resourceId, startsAt: at(18), endsAt: at(19), blockedUntil: at(19), price: 100000 } });
    await system.booking.create({ data: { tenantId: s.tenantId, customerId: c.id, resourceId: s.resourceId, startsAt: at(15), endsAt: at(16), blockedUntil: at(16), price: 999900, status: 'CANCELLED' } });

    const r = await s.api.get('/analytics/today');
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.load).toMatchObject({ bookedMin: 180, capacityMin: 600 });
    expect(d.load.value).toBeCloseTo(0.3);
    expect(d.revenue).toMatchObject({ expected: 400000, done: 300000, bookings: 2 });
    expect(d.revenue.list.map((b: any) => b.customer)).toEqual(['Сегодняшний', 'Сегодняшний']);
    expect(d.topMaster.top).toMatchObject({ id: s.resourceId, amount: 400000, bookings: 2, share: 1 });

    const m = await s.api.post('/resources', { name: 'Мастер' });
    const inv = await s.api.post('/team', { email: `t-${Date.now()}@test.ru`, name: 'М', role: 'MASTER', resourceId: m.body.data.id });
    const login = await api().post('/auth/login', { email: inv.body.data.user.email, password: inv.body.data.tempPassword });
    expect((await api(login.body.data.accessToken).get('/analytics/today')).status).toBe(403);
  });
});
