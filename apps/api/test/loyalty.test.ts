import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, closeApp, createSalon, getApp, resetDb, system, tomorrowAt } from './helpers';

beforeAll(async () => {
  await resetDb();
  await getApp();
});
afterAll(closeApp);

let n = 0;
async function visit(s: Awaited<ReturnType<typeof createSalon>>, customerId: string, time: string, days = 1) {
  const r = await s.api.post('/bookings', { customerId, resourceId: s.resourceId, serviceIds: [s.serviceId], startsAt: tomorrowAt(time, days) });
  expect(r.status).toBe(201);
  return r.body.data.id as string;
}
const complete = (s: Awaited<ReturnType<typeof createSalon>>, id: string) => s.api.post(`/bookings/${id}/status`, { status: 'COMPLETED' });
async function newCustomer(s: Awaited<ReturnType<typeof createSalon>>) {
  n += 1;
  return (await s.api.post('/customers', { name: `Клиент ${n}`, phone: `+7999888${String(n).padStart(4, '0')}` })).body.data.id as string;
}

describe('депозиты', () => {
  it('пополнение по ступени «5000 → +500», пропорциональное списание за визит, откат, возврат денег', async () => {
    const s = await createSalon('Deposit');
    await s.api.patch('/tenant', { settings: { depositTiers: [{ amount: 300000, bonus: 20000 }, { amount: 500000, bonus: 50000 }] } });
    const c = await newCustomer(s);

    const t = await s.api.post(`/customers/${c}/account/topup`, { amount: 5000, method: 'card' });
    expect(t.body.data).toMatchObject({ money: 5000, bonus: 500, added: { money: 5000, bonus: 500 } });

    // Визит 1500 ₽: из 5500 ₽ на балансе списывается пропорционально (деньги 1363,64 + бонусы 136,36)
    const id = await visit(s, c, '12:00');
    await complete(s, id);
    let acc = (await s.api.get(`/customers/${c}/account`)).body.data;
    expect(acc).toMatchObject({ money: 3636.36, bonus: 363.64, total: 4000 });
    expect(acc.entries[0]).toMatchObject({ type: 'CHARGE', money: -1363.64, bonus: -136.36, bookingId: id });
    expect((await s.api.get(`/bookings/${id}`)).body.data.settlement).toEqual({ pass: null, fromBalance: 150000 });

    // Откат завершения возвращает деньги, повторное завершение не списывает дважды
    await s.api.post(`/bookings/${id}/status`, { status: 'ARRIVED' });
    expect((await s.api.get(`/customers/${c}/account`)).body.data.total).toBe(5500);
    await complete(s, id);
    await complete(s, id);
    expect((await s.api.get(`/customers/${c}/account`)).body.data.total).toBe(4000);

    // Возврат: только деньги, бонусы сгорают пропорционально
    expect((await s.api.post(`/customers/${c}/account/refund`, { amount: 99999 })).status).toBe(400);
    const r = await s.api.post(`/customers/${c}/account/refund`, { amount: 3636.36, method: 'cash' });
    expect(r.body.data).toEqual({ money: 0, bonus: 0 });

    // Автосписание можно выключить
    await s.api.patch('/tenant', { settings: { depositAutoCharge: false } });
    await s.api.post(`/customers/${c}/account/topup`, { amount: 1000, bonus: 0 });
    const id2 = await visit(s, c, '15:00');
    await complete(s, id2);
    expect((await s.api.get(`/customers/${c}/account`)).body.data.money).toBe(1000);

    // Журнал денег нельзя переписать даже через роль приложения
    await expect(system.$transaction([
      system.$executeRawUnsafe('SET LOCAL ROLE salon_app'),
      system.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${s.tenantId}', true)`),
      system.$executeRawUnsafe('UPDATE "AccountEntry" SET money = 0'),
    ])).rejects.toThrow(/permission denied/);
  });
});

describe('абонементы', () => {
  it('на визиты: списывается при завершении вместо депозита; закончился — платит депозит', async () => {
    const s = await createSalon('Passes');
    const plan = await s.api.post('/passes/plans', { name: '2 стрижки', kind: 'VISITS', visits: 2, validityDays: 30, price: 2700, serviceIds: [s.serviceId] });
    expect(plan.status).toBe(201);
    const c = await newCustomer(s);
    await s.api.post(`/customers/${c}/account/topup`, { amount: 5000, bonus: 0 });
    const sold = await s.api.post(`/customers/${c}/passes`, { planId: plan.body.data.id, method: 'card' });
    expect(sold.body.data).toMatchObject({ name: '2 стрижки', visitsLeft: 2, status: 'ACTIVE', price: 2700 });

    const v1 = await visit(s, c, '10:00');
    await complete(s, v1);
    expect((await s.api.get(`/bookings/${v1}`)).body.data.settlement).toMatchObject({ pass: { name: '2 стрижки', visitsLeft: 1 }, fromBalance: 0 });
    const v2 = await visit(s, c, '12:00');
    await complete(s, v2);
    const v3 = await visit(s, c, '14:00');
    await complete(s, v3);
    const acc = (await s.api.get(`/customers/${c}/account`)).body.data;
    expect(acc.passes[0]).toMatchObject({ visitsLeft: 0, status: 'USED' });
    expect(acc.money).toBe(3500); // третий визит — с депозита

    // Откат визита по абонементу возвращает визит
    await s.api.post(`/bookings/${v2}/status`, { status: 'ARRIVED' });
    expect((await s.api.get(`/customers/${c}/account`)).body.data.passes[0]).toMatchObject({ visitsLeft: 1, status: 'ACTIVE' });
  });

  it('непиковые часы и безлимит не чаще раза в день', async () => {
    const s = await createSalon('Offpeak');
    const off = await s.api.post('/passes/plans', { name: 'Утро', kind: 'VISITS', visits: 5, validityDays: 30, price: 5000, timeRule: { from: '10:00', to: '12:00' } });
    const unl = await s.api.post('/passes/plans', { name: 'Безлимит', kind: 'UNLIMITED', validityDays: 30, price: 9000 });
    expect((await s.api.post('/passes/plans', { name: 'X', kind: 'VISITS', validityDays: 30, price: 1 })).status).toBe(400);

    const c1 = await newCustomer(s);
    await s.api.post(`/customers/${c1}/passes`, { planId: off.body.data.id });
    const late = await visit(s, c1, '15:00');
    await complete(s, late);
    expect((await s.api.get(`/bookings/${late}`)).body.data.settlement.pass).toBeNull();
    const early = await visit(s, c1, '10:30');
    await complete(s, early);
    expect((await s.api.get(`/bookings/${early}`)).body.data.settlement.pass.name).toBe('Утро');

    const c2 = await newCustomer(s);
    await s.api.post(`/customers/${c2}/passes`, { planId: unl.body.data.id });
    const a = await visit(s, c2, '12:00', 2);
    const b = await visit(s, c2, '17:00', 2);
    const nextDay = await visit(s, c2, '12:00', 3);
    for (const id of [a, b, nextDay]) await complete(s, id);
    const used = await Promise.all([a, b, nextDay].map(async (id) => !!(await s.api.get(`/bookings/${id}`)).body.data.settlement.pass));
    expect(used).toEqual([true, false, true]);
  });

  it('витрина на мини-сайте, баланс по личной ссылке, права', async () => {
    const s = await createSalon('Shop');
    await s.api.patch('/tenant', { settings: { depositTiers: [{ amount: 500000, bonus: 50000 }] } });
    await s.api.post('/passes/plans', { name: '10 визитов', kind: 'VISITS', visits: 10, validityDays: 90, price: 12000 });
    await s.api.post('/passes/plans', { name: 'Скрытый', kind: 'VISITS', visits: 1, validityDays: 10, price: 1, isPublic: false });
    const pub = (await api().get(`/public/${s.slug}`)).body.data.loyalty;
    expect(pub.tiers).toEqual([{ amount: 5000, bonus: 500 }]);
    expect(pub.plans.map((p: any) => p.name)).toEqual(['10 визитов']);

    const book = await api().post(`/public/${s.slug}/book`, { serviceIds: [s.serviceId], resourceId: null, startsAt: tomorrowAt('11:00', 2), name: 'Вика', phone: '+79998889999', consent: true });
    const cust = await system.customer.findFirstOrThrow({ where: { phone: '+79998889999' } });
    await s.api.post(`/customers/${cust.id}/account/topup`, { amount: 5000 });
    const m = (await api().get(`/public/${s.slug}/manage/${book.body.data.manageToken}`)).body.data;
    // Записаться онлайн может любой, кто знает чужой номер, — счёт по такой ссылке не виден, пока клиент не пришёл
    expect(m.wallet).toBeUndefined();
    const bk = await system.booking.findFirstOrThrow({ where: { customerId: cust.id } });
    await s.api.post(`/bookings/${bk.id}/status`, { status: 'ARRIVED', version: bk.version });
    const m2 = (await api().get(`/public/${s.slug}/manage/${book.body.data.manageToken}`)).body.data;
    expect(m2.wallet).toMatchObject({ money: 5000, bonus: 500, passes: [] });

    const inv = await s.api.post('/team', { email: `fin-${Date.now()}@test.ru`, name: 'М', role: 'MASTER', resourceId: s.resourceId });
    const login = await api().post('/auth/login', { email: inv.body.data.user.email, password: inv.body.data.tempPassword });
    const master = api(login.body.data.accessToken);
    expect((await master.post(`/customers/${cust.id}/account/topup`, { amount: 100 })).status).toBe(403);
    expect((await master.get(`/customers/${cust.id}/account`)).status).toBe(403);
  });
});
