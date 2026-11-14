import * as argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totp } from '../src/admin/totp';
import { seal } from '../src/common/secret-box';
import { closeApp, createSalon, getApp, resetDb, system } from './helpers';

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
let srv: any;
beforeAll(async () => {
  await resetDb();
  srv = (await getApp()).getHttpServer();
  await system.adminUser.create({ data: { email: 'owner@mioflow.ru', passwordHash: await argon2.hash('very-long-password-1'), totpSecretEnc: seal(SECRET) } });
});
afterAll(closeApp);

const login = (body: object) => request(srv).post('/v1/admin/auth/login').set('X-Requested-With', 'x').send(body);

describe('панель владельца сервиса', () => {
  it('отдельный вход: пароль + код; аккаунт салона не пускает; задачи для сервера', async () => {
    const salon = await createSalon('Salon');
    // Владелец салона с любыми правами в панель не попадает
    expect((await salon.api.get('/admin/overview')).status).toBe(401);
    expect((await request(srv).get('/v1/admin/overview')).status).toBe(401);

    expect((await login({ email: 'owner@mioflow.ru', password: 'very-long-password-1', code: '000000' })).status).toBe(401);
    expect((await login({ email: 'owner@mioflow.ru', password: 'wrong', code: totp(SECRET) })).status).toBe(401);
    const ok = await login({ email: 'owner@mioflow.ru', password: 'very-long-password-1', code: totp(SECRET) });
    expect(ok.status).toBe(200);
    const cookie = ok.headers['set-cookie'] as unknown as string[];
    expect(cookie[0]).toMatch(/mioflow_admin=.*HttpOnly.*SameSite=Strict/i);
    const as = (r: request.Test) => r.set('Cookie', cookie).set('X-Requested-With', 'x');

    const o = (await as(request(srv).get('/v1/admin/overview'))).body.data;
    expect(o.subscriptions.TRIAL).toBe(1);
    const list = (await as(request(srv).get('/v1/admin/tenants?q=Salon'))).body.data;
    expect(list[0]).toMatchObject({ name: 'Salon', status: 'TRIAL' });
    expect(JSON.stringify(list)).not.toMatch(/customer|phone/i);
    expect((await as(request(srv).post(`/v1/admin/tenants/${salon.tenantId}/extend`)).send({ days: 7 })).status).toBe(200);

    // Задачи для сервера: только из списка, без дублей; без заголовка — отказ (защита от подделки)
    expect((await as(request(srv).post('/v1/admin/tasks')).send({ kind: 'rm -rf /' })).status).toBe(400);
    const t1 = await as(request(srv).post('/v1/admin/tasks')).send({ kind: 'restart' });
    const t2 = await as(request(srv).post('/v1/admin/tasks')).send({ kind: 'restart' });
    expect(t1.body.data.id).toBe(t2.body.data.id);
    expect((await request(srv).post('/v1/admin/tasks').set('Cookie', cookie).send({ kind: 'backup' })).status).toBe(403);
    const tasks = (await as(request(srv).get('/v1/admin/tasks'))).body.data;
    expect(tasks.tasks[0]).toMatchObject({ kind: 'restart', status: 'PENDING', requestedBy: 'owner@mioflow.ru', title: 'Перезапустить API и воркер' });

    // Подделанная cookie не работает
    expect((await request(srv).get('/v1/admin/overview').set('Cookie', 'mioflow_admin=eyJhbGciOiJIUzI1NiJ9.e30.x')).status).toBe(401);
    // Таблицы панели недоступны роли приложения салонов
    const { PrismaClient } = await import('@prisma/client');
    const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    await expect(app.adminUser.count()).rejects.toThrow();
    await app.$disconnect();
  });
});

describe('действия поддержки', () => {
  it('блокировка, удаление с восстановлением, смена данных — только с паролем и кодом', async () => {
    const ok = await login({ email: 'owner@mioflow.ru', password: 'very-long-password-1', code: totp(SECRET) });
    const cookie = ok.headers['set-cookie'] as unknown as string[];
    const as = (r: request.Test) => r.set('Cookie', cookie).set('X-Requested-With', 'x');
    const confirm = { password: 'very-long-password-1', code: totp(SECRET) };
    const s = await createSalon('Support');
    const pub = () => request(srv).get(`/v1/public/${s.slug}`);
    const me = (await s.api.get('/auth/me')).body.data;

    // Карточка — без данных клиентов
    const card = (await as(request(srv).get(`/v1/admin/tenants/${s.tenantId}`))).body.data;
    expect(card).toMatchObject({ name: 'Support', owner: { email: me.user.email }, counts: { masters: 1 } });

    // Без верного кода — ничего не происходит
    expect((await as(request(srv).post(`/v1/admin/tenants/${s.tenantId}/block`)).send({ reason: 'спам', password: 'very-long-password-1', code: '000000' })).status).toBe(403);
    expect((await as(request(srv).post(`/v1/admin/tenants/${s.tenantId}/block`)).send({ reason: 'жалобы клиентов', ...confirm })).status).toBe(200);
    expect((await pub()).status).toBe(404);
    const blocked = await s.api.get('/tenant');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('TENANT_BLOCKED');
    expect((await request(srv).post('/v1/auth/login').set('X-Client', 'mobile').send({ email: me.user.email, password: 'password123' })).body.error.code).toBe('TENANT_BLOCKED');
    expect((await as(request(srv).post(`/v1/admin/tenants/${s.tenantId}/unblock`)).send(confirm)).status).toBe(200);
    expect((await pub()).status).toBe(200);
    expect((await s.api.get('/tenant')).status).toBe(200);

    // Смена названия, адреса и тарифа
    const newSlug = `support-${Date.now() % 100000}`;
    const ed = await as(request(srv).post(`/v1/admin/tenants/${s.tenantId}/edit`)).send({ name: 'Студия Поддержка', slug: newSlug, planCode: 'BUSINESS', ...confirm });
    expect(ed.body).toMatchObject({ success: true });
    expect((await request(srv).get(`/v1/public/${newSlug}`)).body.data.name).toBe('Студия Поддержка');

    // Удаление: нужно точное название
    expect((await as(request(srv).post(`/v1/admin/tenants/${s.tenantId}/delete`)).send({ confirmName: 'Support', reason: 'просьба владельца', ...confirm })).status).toBe(422);
    expect((await as(request(srv).post(`/v1/admin/tenants/${s.tenantId}/delete`)).send({ confirmName: 'Студия Поддержка', reason: 'просьба владельца', ...confirm })).status).toBe(200);
    expect((await request(srv).get(`/v1/public/${newSlug}`)).status).toBe(404);
    expect((await s.api.get('/tenant')).status).toBe(401);
    const deleted = (await as(request(srv).get('/v1/admin/tenants?deleted=1'))).body.data;
    expect(deleted.map((t: any) => t.slug)).toContain(newSlug);

    // Восстановление: тот же адрес, сотрудники снова входят
    const r = await as(request(srv).post(`/v1/admin/tenants/${s.tenantId}/restore`)).send(confirm);
    expect(r.body.data.slug).toBe(newSlug);
    expect((await request(srv).get(`/v1/public/${newSlug}`)).status).toBe(200);
    expect((await request(srv).post('/v1/auth/login').set('X-Client', 'mobile').send({ email: me.user.email, password: 'password123' })).status).toBe(200);

    // Владелец потерял телефон — выключаем вход с кодом; журнал действий виден в карточке
    await system.user.update({ where: { email: me.user.email }, data: { twoFactorEnabled: true } });
    expect((await as(request(srv).post(`/v1/admin/tenants/${s.tenantId}/owner`)).send({ action: 'disable-2fa', ...confirm })).status).toBe(200);
    expect((await system.user.findUniqueOrThrow({ where: { email: me.user.email } })).twoFactorEnabled).toBe(false);
    const history = (await as(request(srv).get(`/v1/admin/tenants/${s.tenantId}`))).body.data.history.map((h: any) => h.action);
    expect(history).toEqual(expect.arrayContaining(['admin.block', 'admin.unblock', 'admin.edit', 'admin.delete', 'admin.restore', 'admin.owner_disable_2fa']));
  });
});
