import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { waitlistTick } from '../src/waitlist/waitlist';
import { api, clearOutbox, closeApp, createSalon, fakeMessengers, getApp, outbox, resetDb, system, tomorrowAt, tomorrowDate } from './helpers';

const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
beforeAll(async () => {
  await resetDb();
  await getApp();
  await fakeMessengers();
});
afterAll(async () => { await app.$disconnect(); await closeApp(); });

describe('лист ожидания', () => {
  it('клиент ждёт окно; когда время освободилось — письмо клиенту и одно уведомление', async () => {
    const s = await createSalon('Wait');
    const day = tomorrowDate(3);
    // Весь день занят
    const off = await s.api.post(`/resources/${s.resourceId}/time-off`, { startsAt: tomorrowAt('00:00', 3), endsAt: tomorrowAt('23:59', 3), reason: 'Отгул' });
    expect(off.status).toBe(201);
    const pub = api();
    expect((await pub.get(`/public/${s.slug}/slots?date=${day}&serviceIds=${s.serviceId}`)).body.data[0]?.slots ?? []).toHaveLength(0);

    const body = { serviceIds: [s.serviceId], resourceId: s.resourceId, date: day, name: 'Жду Окно', phone: '+7 999 555-00-11', email: 'wait@example.ru', consent: true };
    expect((await pub.post(`/public/${s.slug}/waitlist`, { ...body, consent: false })).status).toBe(400);
    const w = await pub.post(`/public/${s.slug}/waitlist`, body);
    expect(w.status).toBe(201);

    clearOutbox();
    expect((await waitlistTick(app, system)).notified).toBe(0);
    // Мастер открыл день
    const blocks = (await s.api.get(`/resources/time-off?date=${day}`)).body.data;
    await s.api.delete(`/resources/${s.resourceId}/time-off/${blocks[0].id}`);
    expect((await waitlistTick(app, system)).notified).toBe(1);
    expect(outbox.email.map((m) => m.to)).toContain('wait@example.ru');
    expect(outbox.email.find((m) => m.to === 'wait@example.ru')!.text).toContain(`/b/${s.slug}?s=${s.serviceId}&m=${s.resourceId}&d=${day}`);
    // Повторно не шлём
    expect((await waitlistTick(app, system)).notified).toBe(0);

    // В приложении салона видно, кто ждал, и можно отметить «записали»
    const list = (await s.api.get(`/waitlist?date=${day}`)).body.data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Жду Окно', phone: '+79995550011', status: 'NOTIFIED', services: ['Стрижка'] });
    expect((await s.api.patch(`/waitlist/${list[0].id}`, { status: 'DONE' })).status).toBe(200);
    expect((await s.api.get(`/waitlist?date=${day}`)).body.data).toHaveLength(0);

    // Другой салон заявку не видит
    const other = await createSalon('Other');
    expect((await other.api.get(`/waitlist?date=${day}`)).body.data).toHaveLength(0);
  });
});
