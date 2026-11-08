import { DateTime } from 'luxon';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, closeApp, createSalon, getApp, resetDb, system, tomorrowAt } from './helpers';

beforeAll(async () => {
  await resetDb();
  await getApp();
});
afterAll(closeApp);

const inDays = (n: number) => DateTime.now().setZone('Europe/Moscow').plus({ days: n }).toISODate()!;

async function nailSalon() {
  const reg = await api().post('/auth/register', {
    email: `nails-${Date.now()}-${Math.random()}@test.ru`, password: 'password123', name: 'Мастер', salonName: 'Ноготки',
    slug: `nails-${Math.floor(Math.random() * 1e6)}`, industry: 'nails', acceptTerms: true, acceptPrivacy: true,
  });
  expect(reg.status).toBe(201);
  const a = api(reg.body.data.accessToken);
  const me = (await a.get('/auth/me')).body.data;
  const services = (await a.get('/services')).body.data as { id: string; name: string }[];
  return { a, resourceId: me.resourceId as string, tenantId: reg.body.data.tenant.id as string, svc: (n: string) => services.find((s) => s.name === n)!.id };
}

describe('склад', () => {
  it('отраслевой набор, приход партиями, автосписание по сроку годности, откат и повторное завершение', async () => {
    const s = await nailSalon();
    const tpl = await s.a.post('/stock/from-template');
    expect(tpl.body.data.created).toBeGreaterThanOrEqual(5);
    expect((await s.a.post('/stock/from-template')).body.data).toEqual({ created: 0, linked: 0 });

    const mats = (await s.a.get('/stock/materials')).body.data as any[];
    const gel = mats.find((m) => m.name === 'Гель-лак');
    expect(gel).toMatchObject({ unit: 'мл', stock: 0, minStock: 30, trackExpiry: true, low: true });

    // Срок годности обязателен для материалов с учётом срока
    expect((await s.a.post('/stock/receipts', { materialId: gel.id, qty: 15 })).status).toBe(400);
    await s.a.post('/stock/receipts', { materialId: gel.id, qty: 15, price: 80, expiresAt: inDays(200) });
    await s.a.post('/stock/receipts', { materialId: gel.id, qty: 15, price: 70, expiresAt: inDays(10) });

    const svc = s.svc('Маникюр с покрытием гель-лак');
    const norms = (await s.a.get(`/stock/norms/${svc}`)).body.data as any[];
    expect(norms.find((n) => n.name === 'Гель-лак').qty).toBe(0.5);

    const bk = await s.a.post('/bookings', { customer: { name: 'Клиентка', phone: '+79995550001' }, resourceId: s.resourceId, serviceIds: [svc], startsAt: tomorrowAt('12:00') });
    expect(bk.status).toBe(201);
    const id = bk.body.data.id;
    expect((await s.a.post(`/bookings/${id}/status`, { status: 'COMPLETED' })).status).toBe(201);

    let d = (await s.a.get(`/stock/materials/${gel.id}`)).body.data;
    expect(d.stock).toBe(29.5);
    // Списано с партии, у которой срок истекает раньше
    expect(d.batches.map((b: any) => [b.expiresAt, b.remaining])).toEqual([[inDays(10), 14.5], [inDays(200), 15]]);
    expect(d.movements[0]).toMatchObject({ type: 'SERVICE', qty: -0.5, bookingId: id, price: 70 });

    // Завершение отменили — материал вернулся; завершили снова — списан один раз
    await s.a.post(`/bookings/${id}/status`, { status: 'ARRIVED' });
    expect((await s.a.get(`/stock/materials/${gel.id}`)).body.data.stock).toBe(30);
    await s.a.post(`/bookings/${id}/status`, { status: 'COMPLETED' });
    d = (await s.a.get(`/stock/materials/${gel.id}`)).body.data;
    expect(d.stock).toBe(29.5);
    expect(d.batches[0].remaining).toBe(14.5);

    // Предупреждения: заканчивается (29,5 ≤ 30) и срок истекает через 10 дней
    const al = (await s.a.get('/stock/alerts')).body.data;
    expect(al.low.map((x: any) => x.name)).toContain('Гель-лак');
    expect(al.expiring.find((x: any) => x.name === 'Гель-лак')).toMatchObject({ remaining: 14.5, daysLeft: 10, expired: false });

    // Списание конкретной партии и инвентаризация
    await s.a.post('/stock/write-off', { materialId: gel.id, qty: 14.5, batchId: d.batches[0].id, reason: 'истекает срок' });
    expect((await s.a.post('/stock/write-off', { materialId: gel.id, qty: 1, batchId: d.batches[0].id, reason: 'x' })).status).toBe(400);
    const inv = await s.a.post('/stock/inventory', { items: [{ materialId: gel.id, actual: 14 }] });
    expect(inv.body.data.items[0].diff).toBe(-1);
    d = (await s.a.get(`/stock/materials/${gel.id}`)).body.data;
    expect(d.stock).toBe(14);
    expect(d.batches).toHaveLength(1);
    expect(d.movements.map((m: any) => m.type).slice(0, 2)).toEqual(['ADJUST', 'WRITE_OFF']);
  });

  it('списание в минус, приход покрывает недостачу; комплекс берёт нормы входящих услуг', async () => {
    const s = await nailSalon();
    await s.a.post('/stock/from-template');
    const files = ((await s.a.get('/stock/materials')).body.data as any[]).find((m) => m.name === 'Пилки одноразовые');
    const combo = s.svc('Комплекс: маникюр + педикюр с покрытием');
    const bk = await s.a.post('/bookings', { customer: { name: 'К', phone: '+79995550002' }, resourceId: s.resourceId, serviceIds: [combo], startsAt: tomorrowAt('11:00') });
    await s.a.post(`/bookings/${bk.body.data.id}/status`, { status: 'COMPLETED' });
    // Маникюр + педикюр → 2 пилки, склад пуст → минус
    expect((await s.a.get(`/stock/materials/${files.id}`)).body.data.stock).toBe(-2);
    await s.a.post('/stock/receipts', { materialId: files.id, qty: 100, price: 5 });
    const d = (await s.a.get(`/stock/materials/${files.id}`)).body.data;
    expect(d.stock).toBe(98);
    expect(d.batches[0]).toMatchObject({ qty: 100, remaining: 98 });
    expect(d.value).toBe(490);
  });

  it('доступ: мастер без права не видит склад; чужой салон не видит материалы', async () => {
    const s = await nailSalon();
    const m = await s.a.post('/stock/materials', { name: 'Перчатки', unit: 'пар', minStock: 10 });
    expect(m.status).toBe(201);
    const inv = await s.a.post('/team', { email: `m-${Date.now()}@test.ru`, name: 'М', role: 'MASTER', resourceId: s.resourceId });
    const login = await api().post('/auth/login', { email: inv.body.data.user.email, password: inv.body.data.tempPassword });
    expect((await api(login.body.data.accessToken).get('/stock/materials')).status).toBe(403);

    const other = await createSalon('Other');
    expect((await other.api.get(`/stock/materials/${m.body.data.id}`)).status).toBe(404);
    expect((await other.api.post('/stock/receipts', { materialId: m.body.data.id, qty: 1 })).status).toBe(404);
    expect(await system.material.count({ where: { tenantId: other.tenantId } })).toBe(0);
  });
});
