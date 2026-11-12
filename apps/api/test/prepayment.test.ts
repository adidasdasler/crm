import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepaymentTick, salonPay } from '../src/prepayment/prepayment';
import { api, closeApp, createSalon, getApp, resetDb, system, tomorrowAt, tomorrowDate } from './helpers';

const calls: { shopId: string; amount: number; meta: Record<string, string> }[] = [];
const paid = new Set<string>();
beforeAll(async () => {
  await resetDb();
  await getApp();
  // Подмена ЮKassa: ключ «good-secret-key» верный, оплату отмечает тест
  salonPay.verify = async (c) => c.secret === 'good-secret-key';
  salonPay.create = async (c, p) => { calls.push({ shopId: c.shopId, amount: p.amount, meta: p.metadata }); return { externalId: `yk_${p.idempotenceKey}`, confirmationUrl: `https://yoomoney.ru/checkout/${p.idempotenceKey}` }; };
  salonPay.status = async (_c, ext) => (paid.has(ext) ? 'succeeded' : 'pending');
});
afterAll(closeApp);

describe('онлайн-предоплата в ЮKassa салона', () => {
  it('ключи проверяются и не возвращаются; предоплата 30% → оплата → отметка; без оплаты запись отменяется', async () => {
    const s = await createSalon('Prepay');
    expect((await s.api.put('/prepayment/settings', { enabled: true, mode: 'percent', value: 30, shopId: '123456', secretKey: 'wrong-secret-key' })).status).toBe(422);
    const ok = await s.api.put('/prepayment/settings', { enabled: true, mode: 'percent', value: 30, shopId: '123456', secretKey: 'good-secret-key' });
    expect(ok.status).toBe(200);
    const got = (await s.api.get('/prepayment/settings')).body.data;
    expect(got).toEqual({ enabled: true, mode: 'percent', value: 30, shopId: '123456', hasSecret: true });
    const row = await system.tenantPaymentSettings.findUniqueOrThrow({ where: { tenantId: s.tenantId } });
    expect(row.secretEnc).not.toContain('good-secret-key');

    const pub = api();
    expect((await pub.get(`/public/${s.slug}`)).body.data.prepayment).toEqual({ mode: 'percent', value: 30 });
    const slot = (await pub.get(`/public/${s.slug}/slots?date=${tomorrowDate(2)}&serviceIds=${s.serviceId}`)).body.data[0].slots[0];
    const b = await pub.post(`/public/${s.slug}/book`, { serviceIds: [s.serviceId], resourceId: null, startsAt: slot, name: 'Платящая', phone: '+79990003344', consent: true });
    expect(b.status).toBe(201);
    // Стрижка 1500 ₽ → 30% = 450 ₽; платёж в магазине салона
    expect(b.body.data).toMatchObject({ prepaid: 45000, payUrl: expect.stringContaining('yoomoney.ru') });
    expect(calls.at(-1)).toMatchObject({ shopId: '123456', amount: 45000 });
    const token = b.body.data.manageToken;
    expect((await pub.get(`/public/${s.slug}/manage/${token}`)).body.data.payment).toMatchObject({ amount: 45000, status: 'PENDING' });

    // Клиент оплатил и вернулся
    paid.add(`yk_${calls.at(-1)!.meta.bookingPaymentId}`);
    expect((await pub.post(`/public/${s.slug}/manage/${token}/pay-check`)).body.data.status).toBe('SUCCEEDED');
    const staff = (await s.api.get(`/bookings/${b.body.data.id}`)).body.data;
    expect(staff.payments[0]).toMatchObject({ amount: 45000, status: 'SUCCEEDED' });

    // Вторая запись без оплаты: через 20 минут отменяется, время освобождается
    const slot2 = tomorrowAt('15:00', 2);
    const b2 = await pub.post(`/public/${s.slug}/book`, { serviceIds: [s.serviceId], resourceId: null, startsAt: slot2, name: 'Не платит', phone: '+79990005566', consent: true });
    expect(b2.status).toBe(201);
    expect((await prepaymentTick(system)).cancelled).toBe(0);
    expect((await prepaymentTick(system, new Date(Date.now() + 25 * 60_000))).cancelled).toBe(1);
    expect((await system.booking.findUniqueOrThrow({ where: { id: b2.body.data.id } })).status).toBe('CANCELLED');
    expect((await system.booking.findUniqueOrThrow({ where: { id: b.body.data.id } })).status).not.toBe('CANCELLED');
    const free = (await pub.get(`/public/${s.slug}/slots?date=${tomorrowDate(2)}&serviceIds=${s.serviceId}`)).body.data[0].slots;
    expect(free).toContain(slot2);
  });
});
