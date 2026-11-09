import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanJpeg } from '../src/media/storage';
import { api, closeApp, createSalon, getApp, resetDb, system, tomorrowAt } from './helpers';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', n));
let app: Awaited<ReturnType<typeof getApp>>;
beforeAll(async () => {
  await resetDb();
  app = await getApp();
});
afterAll(closeApp);

/** Загрузка multipart: фото + миниатюра + данные JSON */
function upload(token: string, data: object, image = fx('design-full.jpg'), thumb = fx('design-thumb.jpg')) {
  return request(app.getHttpServer()).post('/v1/designs')
    .set('Authorization', `Bearer ${token}`).set('X-Client', 'mobile')
    .attach('image', image, 'a.jpg').attach('thumb', thumb, 'b.jpg')
    .field('data', JSON.stringify(data));
}

describe('библиотека дизайнов', () => {
  it('EXIF с координатами и моделью телефона вырезается, размеры читаются', () => {
    const raw = fx('design-full.jpg');
    expect(raw.includes('SecretPhoneMaker')).toBe(true);
    const c = cleanJpeg(raw)!;
    expect(c).toMatchObject({ width: 240, height: 180 });
    expect(c.data.includes('SecretPhoneMaker')).toBe(false);
    expect(c.data.includes('Exif')).toBe(false);
    expect(cleanJpeg(fx('not-image.jpg'))).toBeNull();
  });

  it('загрузка к визиту клиента, теги, материалы, портфолио на сайте, права', async () => {
    const s = await createSalon('Designs');
    const mat = await s.api.post('/stock/materials', { name: 'Гель-лак #12', unit: 'мл' });
    const bk = await s.api.post('/bookings', { customer: { name: 'Алина', phone: '+79995551111' }, resourceId: s.resourceId, serviceIds: [s.serviceId], startsAt: tomorrowAt('12:00') });

    const up = await upload(s.token, { title: 'Френч с блёстками', tags: ['Френч', 'блёстки', 'френч'], bookingId: bk.body.data.id, materialIds: [mat.body.data.id], materialNote: 'топ без липкого слоя', isPublic: true });
    expect(up.status).toBe(201);
    const d = up.body.data;
    expect(d).toMatchObject({ tags: ['френч', 'блёстки'], resourceId: s.resourceId, serviceId: s.serviceId, isPublic: true, width: 240, height: 180 });
    expect(d.customerId).toBe(bk.body.data.customerId);

    // Файл на диске — без EXIF
    const img = await request(app.getHttpServer()).get(`/v1/designs/${d.id}/image/full`).set('Authorization', `Bearer ${s.token}`).set('X-Client', 'mobile').buffer(true);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect(img.body.includes('SecretPhoneMaker')).toBe(false);

    // Фильтры и карточка клиента
    expect((await s.api.get('/designs?tag=френч')).body.data).toHaveLength(1);
    expect((await s.api.get(`/designs?customerId=${d.customerId}`)).body.data[0]).toMatchObject({ customer: 'Алина', master: expect.any(String) });
    expect((await s.api.get('/designs/tags')).body.data).toEqual(expect.arrayContaining([{ tag: 'френч', count: 1 }]));
    const one = (await s.api.get(`/designs/${d.id}`)).body.data;
    expect(one.materials.map((m: any) => m.name)).toEqual(['Гель-лак #12']);

    // Портфолио: видно публичное фото, без данных клиента
    const pf = (await api().get(`/public/${s.slug}/portfolio`)).body.data;
    expect(pf).toHaveLength(1);
    expect(pf[0]).not.toHaveProperty('customerId');
    expect((await api().get(`/public/${s.slug}/portfolio/${d.id}/thumb`)).headers['content-type']).toBe('image/jpeg');

    // Не JPEG — отказ
    expect((await upload(s.token, {}, fx('not-image.jpg'))).status).toBe(400);

    // Мастер загружает своё, но не публикует и не трогает чужое
    const inv = await s.api.post('/team', { email: `d-${Date.now()}@test.ru`, name: 'М', role: 'MASTER', resourceId: s.resourceId });
    const login = await api().post('/auth/login', { email: inv.body.data.user.email, password: inv.body.data.tempPassword });
    const mt = login.body.data.accessToken as string;
    const mine = await upload(mt, { title: 'Моё', isPublic: true });
    expect(mine.status).toBe(201);
    expect(mine.body.data.isPublic).toBe(false);
    expect((await api(mt).patch(`/designs/${mine.body.data.id}`, { tags: ['нюд'] })).status).toBe(200);
    expect((await api(mt).patch(`/designs/${mine.body.data.id}`, { isPublic: true })).status).toBe(403);
    expect((await api(mt).delete(`/designs/${d.id}`)).status).toBe(403);
    // Мастер не видит имя клиента
    expect((await api(mt).get(`/designs/${d.id}`)).body.data.customer).toBeNull();

    // Чужой салон не видит фото
    const other = await createSalon('Other');
    expect((await other.api.get(`/designs/${d.id}`)).status).toBe(404);
    expect((await request(app.getHttpServer()).get(`/v1/designs/${d.id}/image/full`).set('Authorization', `Bearer ${other.token}`).set('X-Client', 'mobile')).status).toBe(404);

    // Удаление клиента отвязывает фото от него; удаление фото стирает файл
    await s.api.delete(`/customers/${d.customerId}`);
    expect((await system.design.findUniqueOrThrow({ where: { id: d.id } })).customerId).toBeNull();
    expect((await s.api.delete(`/designs/${d.id}`)).status).toBe(200);
    expect((await api().get(`/public/${s.slug}/portfolio/${d.id}/thumb`)).status).toBe(404);
  });
});
