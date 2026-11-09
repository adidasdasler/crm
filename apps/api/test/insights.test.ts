import { DateTime } from 'luxon';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insightsDigestTick } from '../src/insights/digest';
import { api, clearOutbox, closeApp, createSalon, fakeMessengers, getApp, outbox, resetDb, system, tgUpdate } from './helpers';

beforeAll(async () => {
  await resetDb();
  await getApp();
  await fakeMessengers();
});
afterAll(closeApp);

const TZ = 'Europe/Moscow';
const at = (daysAgo: number, h: number) => DateTime.now().setZone(TZ).startOf('day').minus({ days: daysAgo }).set({ hour: h }).toJSDate();

describe('советы владельцу', () => {
  it('находят перегруз мастера, повод поднять цену, неявки, мало онлайн-записей, пропавших клиентов и склад', async () => {
    const s = await createSalon('Insights');
    const all = Object.fromEntries(['1', '2', '3', '4', '5', '6', '7'].map((d) => [d, [['10:00', '20:00']]]));
    const olga = await s.api.post('/resources', { name: 'Ольга', schedule: all });
    expect(olga.status).toBe(201);
    const c = await system.customer.create({ data: { tenantId: s.tenantId, name: 'Постоянная', phone: '+79997770001' } });

    // Анна (мастер по умолчанию) занята весь день 14 дней подряд, 2 неявки
    for (let d = 1; d <= 14; d++) {
      const b = await system.booking.create({
        data: { tenantId: s.tenantId, customerId: c.id, resourceId: s.resourceId, startsAt: at(d, 10), endsAt: at(d, 20), blockedUntil: at(d, 20), price: 500000, status: d <= 2 ? 'NO_SHOW' : 'COMPLETED' },
      });
      if (d > 2 && d <= 8) await system.review.create({ data: { tenantId: s.tenantId, bookingId: b.id, customerId: c.id, resourceId: s.resourceId, rating: 5, source: 'WEB' } });
    }
    // Клиентка ходила раз в 20 дней, но не была уже 80 дней
    const lost = await system.customer.create({ data: { tenantId: s.tenantId, name: 'Пропавшая Вера', phone: '+79997770002' } });
    for (const d of [120, 100, 80]) {
      await system.booking.create({ data: { tenantId: s.tenantId, customerId: lost.id, resourceId: olga.body.data.id, startsAt: at(d, 12), endsAt: at(d, 13), blockedUntil: at(d, 13), price: 100000, status: 'COMPLETED' } });
    }
    await s.api.post('/stock/materials', { name: 'Лезвия', unit: 'шт', minStock: 10 });

    const r = await s.api.get('/analytics/insights');
    expect(r.status).toBe(200);
    const codes = (r.body.data as any[]).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['imbalance', `raise_price:${s.resourceId}`, 'no_show', 'online_share', 'lapsed', 'stock', 'weak_band']));
    const lapsed = (r.body.data as any[]).find((i) => i.code === 'lapsed');
    expect(lapsed.customers.map((x: any) => x.name)).toEqual(['Пропавшая Вера']);
    const imb = (r.body.data as any[]).find((i) => i.code === 'imbalance');
    expect(imb.title).toContain('Ольга');
    // Предупреждения идут первыми
    expect(r.body.data[0].level).toBe('warn');

    // Еженедельная сводка: в понедельник после 10:00 — один раз
    const link = await s.api.post('/me/telegram');
    await tgUpdate({ message: { chat: { id: 4401 }, text: `/start ${new URL(link.body.data.url).searchParams.get('start')}` } });
    const monday = DateTime.now().setZone(TZ).startOf('week').plus({ weeks: 1 }).set({ hour: 10, minute: 30 }).toJSDate();
    const sunday = DateTime.fromJSDate(monday).minus({ days: 1 }).toJSDate();
    clearOutbox();
    expect((await insightsDigestTick(system, sunday)).sent).toBe(0);
    expect((await insightsDigestTick(system, monday)).sent).toBeGreaterThanOrEqual(1);
    const msg = outbox.telegram.find((m) => m.body.chat_id === '4401');
    expect(msg?.body.text).toContain('Неделя в «Insights»');
    expect(msg?.body.text).toContain('💡');
    clearOutbox();
    await insightsDigestTick(system, new Date(+monday + 3600_000));
    expect(outbox.telegram.some((m) => m.body.chat_id === '4401')).toBe(false);

    // Мастеру советы недоступны
    const inv = await s.api.post('/team', { email: `ins-${Date.now()}@test.ru`, name: 'М', role: 'MASTER', resourceId: olga.body.data.id });
    const login = await api().post('/auth/login', { email: inv.body.data.user.email, password: inv.body.data.tempPassword });
    expect((await api(login.body.data.accessToken).get('/analytics/insights')).status).toBe(403);
  });
});
