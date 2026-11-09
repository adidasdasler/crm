import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, closeApp, createSalon, getApp, resetDb, system, tomorrowAt, tomorrowDate } from './helpers';

beforeAll(async () => {
  await resetDb();
  await getApp();
});
afterAll(closeApp);

describe('auth', () => {
  it('регистрация требует согласия, логин, me, refresh с ротацией и обнаружением кражи', async () => {
    const noConsent = await api().post('/auth/register', { email: 'x@test.ru', password: 'password123', name: 'X', salonName: 'X', slug: 'xsalon' });
    expect(noConsent.status).toBe(400);

    const s = await createSalon('Auth');
    const me = await s.api.get('/auth/me');
    expect(me.body.data.role).toBe('OWNER');
    expect(me.body.data.tenant.slug).toBe(s.slug);

    const r1 = await api().post('/auth/refresh', { refreshToken: s.refreshToken });
    expect(r1.status).toBe(200);
    const newRefresh = r1.body.data.refreshToken;
    expect(newRefresh).not.toBe(s.refreshToken);

    // Повторное использование старого токена → отзыв всей цепочки, новый тоже перестаёт работать.
    expect((await api().post('/auth/refresh', { refreshToken: s.refreshToken })).status).toBe(401);
    expect((await api().post('/auth/refresh', { refreshToken: newRefresh })).status).toBe(401);
  });

  it('блокировка после 5 неудачных попыток', async () => {
    await api().post('/auth/register', { email: 'lock@test.ru', password: 'password123', name: 'LL', salonName: 'Lock', slug: 'lock-salon', acceptTerms: true, acceptPrivacy: true });
    for (let i = 0; i < 5; i++) {
      expect((await api().post('/auth/login', { email: 'lock@test.ru', password: 'wrong-pass' })).status).toBe(401);
    }
    expect((await api().post('/auth/login', { email: 'lock@test.ru', password: 'password123' })).status).toBe(423);
  });

  it('cookie-авторизация требует X-Requested-With для мутаций (CSRF)', async () => {
    const s = await createSalon('Csrf');
    const app = await getApp();
    const { default: request } = await import('supertest');
    const login = await request(app.getHttpServer()).post('/v1/auth/login').send({ email: (await s.api.get('/auth/me')).body.data.user.email, password: 'password123' });
    const cookies = login.headers['set-cookie'] as unknown as string[];
    expect(cookies.join(';')).toContain('HttpOnly');
    const noHeader = await request(app.getHttpServer()).post('/v1/customers').set('Cookie', cookies).send({ name: 'A', phone: '89161112233' });
    expect(noHeader.status).toBe(403);
    const ok = await request(app.getHttpServer()).post('/v1/customers').set('Cookie', cookies).set('X-Requested-With', 'salon').send({ name: 'A', phone: '89161112233' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.phone).toBe('+79161112233');
  });
});

describe('изоляция тенантов', () => {
  it('салон B не видит и не может изменить данные салона A', async () => {
    const A = await createSalon('Салон A');
    const B = await createSalon('Салон B');
    const c = await A.api.post('/customers', { name: 'Клиент A', phone: '+79990001111' });
    const bk = await A.api.post('/bookings', { customerId: c.body.data.id, resourceId: A.resourceId, serviceIds: [A.serviceId], startsAt: tomorrowAt('12:00') });
    expect(bk.status).toBe(201);

    expect((await B.api.get('/customers')).body.data).toHaveLength(0);
    expect((await B.api.get(`/customers/${c.body.data.id}`)).status).toBe(404);
    expect((await B.api.patch(`/customers/${c.body.data.id}`, { name: 'hack' })).status).toBe(404);
    expect((await B.api.get(`/bookings/${bk.body.data.id}`)).status).toBe(404);
    expect((await B.api.post(`/bookings/${bk.body.data.id}/status`, { status: 'CANCELLED' })).status).toBe(404);
    expect((await B.api.get(`/resources/${A.resourceId}`)).status).toBe(404);
    // Попытка записать клиента A к мастеру A из салона B.
    expect((await B.api.post('/bookings', { customerId: c.body.data.id, resourceId: A.resourceId, serviceIds: [A.serviceId], startsAt: tomorrowAt('15:00') })).status).toBe(404);
    // Привязать чужую услугу к своему мастеру.
    expect((await B.api.put(`/resources/${B.resourceId}/services`, { serviceIds: [A.serviceId] })).status).toBe(404);
  });

  it('RLS на уровне БД: роль приложения без tenant_id не видит ничего', async () => {
    const { PrismaClient } = await import('@prisma/client');
    const appDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    expect(await appDb.customer.count()).toBe(0);
    expect(await appDb.booking.count()).toBe(0);
    await expect(appDb.$queryRaw`SELECT "passwordHash" FROM "User" LIMIT 1`).rejects.toThrow();
    await appDb.$disconnect();
    expect(await system.customer.count()).toBeGreaterThan(0);
  });
});

describe('записи', () => {
  it('пересечения запрещены, в т.ч. с учётом перерыва; параллельные запросы — ровно один успех', async () => {
    const s = await createSalon('Book');
    const c = await s.api.post('/customers', { name: 'Иван', phone: '+79995550000' });
    const body = (time: string) => ({ customerId: c.body.data.id, resourceId: s.resourceId, serviceIds: [s.serviceId], startsAt: tomorrowAt(time) });

    const first = await s.api.post('/bookings', body('12:00'));
    expect(first.status).toBe(201);
    expect(first.body.data.items[0].name).toBe('Стрижка');
    // 12:00–13:00 + перерыв 15 мин → 13:00 занято, 13:15 свободно.
    expect((await s.api.post('/bookings', body('12:30'))).body.error.code).toBe('SLOT_TAKEN');
    expect((await s.api.post('/bookings', body('13:00'))).status).toBe(409);
    expect((await s.api.post('/bookings', body('13:15'))).status).toBe(201);

    // Гонка: 10 одновременных записей на одно время.
    const results = await Promise.all(Array.from({ length: 10 }, () => s.api.post('/bookings', body('16:00'))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(9);

    // Вне графика — нельзя, с флагом — можно.
    expect((await s.api.post('/bookings', body('21:00'))).body.error.code).toBe('OUTSIDE_SCHEDULE');
    expect((await s.api.post('/bookings', { ...body('21:00'), allowOutsideSchedule: true })).status).toBe(201);
  });

  it('слоты, переходы статусов, optimistic locking, статистика клиента', async () => {
    const s = await createSalon('Flow');
    const bk = await s.api.post('/bookings', { customer: { name: 'Ольга', phone: '8 (916) 000-11-22' }, resourceId: s.resourceId, serviceIds: [s.serviceId], startsAt: tomorrowAt('10:00') });
    expect(bk.status).toBe(201);

    const slots = await s.api.get(`/bookings/slots?date=${tomorrowDate()}&serviceIds=${s.serviceId}`);
    const times: string[] = slots.body.data[0].slots;
    expect(times).not.toContain(tomorrowAt('10:00'));
    expect(times).not.toContain(tomorrowAt('11:00')); // перерыв до 11:15
    expect(times).toContain(tomorrowAt('11:15'));
    expect(times.at(-1)).toBe(tomorrowAt('19:00'));

    const id = bk.body.data.id;
    expect((await s.api.post(`/bookings/${id}/status`, { status: 'CONFIRMED', version: 0 })).status).toBe(201);
    expect((await s.api.post(`/bookings/${id}/status`, { status: 'ARRIVED', version: 0 })).body.error.code).toBe('BOOKING_VERSION_MISMATCH');
    expect((await s.api.patch(`/bookings/${id}`, { version: 1, startsAt: tomorrowAt('14:00') })).status).toBe(200);
    const done = await s.api.post(`/bookings/${id}/status`, { status: 'COMPLETED' });
    expect(done.body.data.status).toBe('COMPLETED');
    expect((await s.api.post(`/bookings/${id}/status`, { status: 'CANCELLED' })).body.error.code).toBe('INVALID_TRANSITION');

    const cust = await s.api.get(`/customers/${bk.body.data.customer.id}`);
    expect(cust.body.data.totalVisits).toBe(1);
    expect(cust.body.data.totalSpent).toBe(150000);
  });

  it('мастер видит только свои записи', async () => {
    const s = await createSalon('Team');
    const m2 = await s.api.post('/resources', { name: 'Второй мастер', serviceIds: [s.serviceId], schedule: Object.fromEntries(['1','2','3','4','5','6','7'].map((d) => [d, [['10:00', '20:00']]])) });
    const inv = await s.api.post('/team', { email: `master-${Date.now()}@test.ru`, name: 'Мастер', role: 'MASTER', resourceId: m2.body.data.id });
    expect(inv.status).toBe(201);
    const login = await api().post('/auth/login', { email: inv.body.data.user.email, password: inv.body.data.tempPassword });
    const master = api(login.body.data.accessToken);

    await s.api.post('/bookings', { customer: { name: 'К1', phone: '+79990000001' }, resourceId: s.resourceId, serviceIds: [s.serviceId], startsAt: tomorrowAt('12:00') });
    await s.api.post('/bookings', { customer: { name: 'К2', phone: '+79990000002' }, resourceId: m2.body.data.id, serviceIds: [s.serviceId], startsAt: tomorrowAt('12:00') });
    const list = await master.get(`/bookings?date=${tomorrowDate()}`);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].resourceId).toBe(m2.body.data.id);
    expect((await master.post('/services', { name: 'x', price: 1, duration: 10 })).status).toBe(403);
  });
});

describe('онлайн-запись', () => {
  it('клиент записывается, получает ссылку управления и может отменить', async () => {
    const s = await createSalon('Public');
    const pub = api();
    const salon = await pub.get(`/public/${s.slug}`);
    expect(salon.body.data.available).toBe(true);
    const services = await pub.get(`/public/${s.slug}/services`);
    expect(services.body.data.services).toHaveLength(1);

    const slots = await pub.get(`/public/${s.slug}/slots?date=${tomorrowDate(2)}&serviceIds=${s.serviceId}`);
    const slot = slots.body.data[0].slots[0];
    expect(slot).toBe(tomorrowAt('10:00', 2));

    const payload = { serviceIds: [s.serviceId], resourceId: null, startsAt: slot, name: 'Светлана', phone: '+7 999 123-45-67', consent: true };
    expect((await pub.post(`/public/${s.slug}/book`, { ...payload, consent: false })).status).toBe(400);
    expect((await pub.post(`/public/${s.slug}/book`, { ...payload, website: 'spam' })).status).toBe(400);
    const booked = await pub.post(`/public/${s.slug}/book`, payload);
    expect(booked.status).toBe(201);
    expect(booked.body.data.manageUrl).toContain('/manage/');
    expect((await pub.post(`/public/${s.slug}/book`, payload)).status).toBe(409);
    // Вне сетки слотов (10:05) онлайн записаться нельзя.
    expect((await pub.post(`/public/${s.slug}/book`, { ...payload, startsAt: tomorrowAt('15:05', 2) })).status).toBe(409);

    const token = booked.body.data.manageToken;
    const info = (await pub.get(`/public/${s.slug}/manage/${token}`)).body.data;
    expect(info.canCancel).toBe(true);
    // «Записаться снова» и «Мои записи»: тот же мастер и услуги, часовой пояс салона
    expect(info).toMatchObject({ serviceIds: [s.serviceId], resourceId: s.resourceId, salon: { slug: s.slug, timezone: 'Europe/Moscow' } });
    // Файл для календаря телефона
    const ics = await pub.get(`/public/${s.slug}/manage/${token}/calendar.ics`);
    expect(ics.status).toBe(200);
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.text).toContain('BEGIN:VEVENT');
    expect(ics.text).toContain(`DTSTART:${slot.replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`);
    expect(ics.text).toContain('SUMMARY:Стрижка');
    expect((await pub.get(`/public/${s.slug}/manage/bad-token/calendar.ics`)).status).toBe(404);
    // Токен чужого салона не работает.
    const other = await createSalon('Other');
    expect((await pub.get(`/public/${other.slug}/manage/${token}`)).status).toBe(404);
    expect((await pub.post(`/public/${s.slug}/manage/${token}/cancel`)).body.data.status).toBe('CANCELLED');

    const reminders = await system.reminder.findMany({ where: { booking: { id: booked.body.data.id } } });
    expect(reminders.map((r) => r.status)).toEqual(['CANCELLED', 'CANCELLED']);
  });
});

describe('защита онлайн-записи', () => {
  it('не больше 3 будущих онлайн-записей на один номер', async () => {
    const s = await createSalon('Spam');
    const pub = api();
    const slots = (await pub.get(`/public/${s.slug}/slots?date=${tomorrowDate(3)}&serviceIds=${s.serviceId}`)).body.data[0].slots as string[];
    const book = (startsAt: string) => pub.post(`/public/${s.slug}/book`, { serviceIds: [s.serviceId], resourceId: null, startsAt, name: 'Спам', phone: '+79990009999', consent: true });
    for (const i of [0, 8, 16]) expect((await book(slots[i])).status).toBe(201);
    const fourth = await book(slots[24]);
    expect(fourth.status).toBe(429);
    expect(fourth.body.error.code).toBe('TOO_MANY_BOOKINGS');
  });
});

describe('мини-сайт и отрасли', () => {
  it('HTML для роботов с разметкой schema.org, QR-код, часы работы, отрасль при регистрации', async () => {
    const reg = await api().post('/auth/register', {
      email: `fit-${Date.now()}@test.ru`, password: 'password123', name: 'Тренер', salonName: 'Студия <Йога>', slug: `yoga-${Date.now() % 100000}`,
      industry: 'fitness', acceptTerms: true, acceptPrivacy: true,
    });
    expect(reg.status).toBe(201);
    const a = api(reg.body.data.accessToken);
    const slug = reg.body.data.tenant.slug;
    const tenant = (await a.get('/tenant')).body.data;
    expect(tenant.industry.terms.staff).toBe('Тренер');
    expect((await a.get('/services')).body.data.map((s: any) => s.name)).toContain('Персональная тренировка');
    await a.patch('/tenant', { address: 'Москва, Тверская, 1', settings: { about: 'Йога для начинающих', links: { vk: 'https://vk.com/yoga' } } });
    expect((await a.patch('/tenant', { settings: { links: { vk: 'javascript:alert(1)' } } })).status).toBe(400);

    const pub = (await api().get(`/public/${slug}`)).body.data;
    expect(pub.hoursText).toBe('Пн–Пт 10:00–20:00, Сб 10:00–18:00, Вс выходной');
    expect(pub.industry.code).toBe('fitness');
    expect(pub.links.vk).toBe('https://vk.com/yoga');

    const page = await api().get(`/public/${slug}/page`);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.text).toContain('Студия &lt;Йога&gt;');
    expect(page.text).not.toContain('<Йога>');
    const ld = JSON.parse(page.text.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);
    expect(ld['@type']).toBe('ExerciseGym');
    expect(ld.address.streetAddress).toBe('Москва, Тверская, 1');
    expect(ld.hasOfferCatalog.itemListElement.length).toBeGreaterThan(0);
    expect(ld.openingHoursSpecification).toHaveLength(6);

    const qr = await api().get(`/public/${slug}/qr.svg?src=yandex`);
    expect((await api().get(`/public/${slug}/qr.png`)).headers['content-type']).toBe('image/png');
    expect(qr.headers['content-type']).toContain('image/svg+xml');
    expect((await api().get('/public-meta/industries')).body.data.some((i: any) => i.code === 'education')).toBe(true);
  });
});

describe('комплексы и ближайшее время', () => {
  it('барбершоп получает комплекс «стрижка + борода»; комплекс из комплекса нельзя; PATCH не сбрасывает перерыв', async () => {
    const reg = await api().post('/auth/register', {
      email: `barber-${Date.now()}@test.ru`, password: 'password123', name: 'Барбер', salonName: 'Борода', slug: `beard-${Date.now() % 100000}`,
      industry: 'barber', acceptTerms: true, acceptPrivacy: true,
    });
    const a = api(reg.body.data.accessToken);
    const slug = reg.body.data.tenant.slug;
    const services = (await a.get('/services')).body.data as any[];
    const combo = services.find((s) => s.name.startsWith('Комплекс'));
    const parts = services.filter((s) => combo.comboOf.includes(s.id)).map((s) => s.name).sort();
    expect(parts).toEqual(['Мужская стрижка', 'Стрижка бороды']);
    const pub = (await api().get(`/public/${slug}/services`)).body.data.services;
    expect(pub.find((s: any) => s.id === combo.id).comboOf).toHaveLength(2);

    expect((await a.post('/services', { name: 'X', price: 1, duration: 30, comboOf: [combo.id, parts[0] && services[0].id] })).status).toBe(400);
    expect((await a.post('/services', { name: 'X', price: 1, duration: 30, comboOf: [services[0].id] })).status).toBe(400);

    const withBuffer = await a.post('/services', { name: 'Бритьё', price: 90000, duration: 30, bufferTime: 15 });
    await a.patch(`/services/${withBuffer.body.data.id}`, { price: 95000 });
    expect((await a.get('/services')).body.data.find((s: any) => s.id === withBuffer.body.data.id)).toMatchObject({ price: 95000, bufferTime: 15 });
  });

  it('ближайшее свободное время у мастеров', async () => {
    const s = await createSalon('Nearest');
    const r = await api().get(`/public/${s.slug}/nearest?serviceIds=${s.serviceId}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0].resourceId).toBe(s.resourceId);
    expect(new Date(r.body.data[0].at).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(r.body.data[0].at).getTime() - Date.now()).toBeLessThan(2 * 86400_000);
  });
});

describe('график 2/2 через API', () => {
  it('сохраняется, отдаёт свободное время только в рабочие смены, особый день закрывает запись', async () => {
    const { DateTime } = await import('luxon');
    const s = await createSalon('Cycle');
    const d = (n: number) => DateTime.now().setZone('Europe/Moscow').plus({ days: n }).toISODate()!;
    const schedule = { mode: 'cycle', start: d(1), on: 2, off: 2, hours: [['10:00', '20:00']], overrides: { [d(2)]: [] } };
    expect((await s.api.patch(`/resources/${s.resourceId}`, { schedule })).status).toBe(200);
    expect((await s.api.patch(`/resources/${s.resourceId}`, { schedule: { mode: 'cycle', start: d(1), on: 2, off: 2, hours: [] } })).status).toBe(400);
    const slots = async (n: number) => ((await api().get(`/public/${s.slug}/slots?date=${d(n)}&serviceIds=${s.serviceId}`)).body.data as any[]).flatMap((r) => r.slots).length;
    expect(await slots(1)).toBeGreaterThan(0); // рабочая смена
    expect(await slots(2)).toBe(0); // особый день — выходной
    expect(await slots(3)).toBe(0); // выходные по графику
    expect(await slots(4)).toBe(0);
    expect(await slots(5)).toBeGreaterThan(0); // снова смена
    expect((await api().get(`/public/${s.slug}`)).body.data.hoursText).toContain('10:00–20:00');
  });
});

describe('регистрация частного мастера', () => {
  it('достаточно имени: тариф «Соло», адрес страницы из имени, повтор имени — свободный адрес', async () => {
    const reg = async (email: string) => api().post('/auth/register', {
      kind: 'solo', name: 'Анна Смирнова', email, password: 'password123', industry: 'nails', acceptTerms: true, acceptPrivacy: true,
    });
    const r1 = await reg(`solo1-${Date.now()}@test.ru`);
    expect(r1.status).toBe(201);
    expect(r1.body.data.tenant).toMatchObject({ name: 'Анна Смирнова', slug: expect.stringMatching(/^anna-smirnova/) });
    const a = api(r1.body.data.accessToken);
    expect((await a.get('/billing/subscription')).body.data.plan.code).toBe('SOLO');
    expect((await a.get('/auth/me')).body.data.solo).toBe(true);
    const r2 = await reg(`solo2-${Date.now()}@test.ru`);
    expect(r2.status).toBe(201);
    expect(r2.body.data.tenant.slug).not.toBe(r1.body.data.tenant.slug);

    // Салону название и адрес по-прежнему обязательны
    const bad = await api().post('/auth/register', { kind: 'salon', name: 'Ольга', email: `s-${Date.now()}@test.ru`, password: 'password123', acceptTerms: true, acceptPrivacy: true });
    expect(bad.status).toBe(400);
  });
});
