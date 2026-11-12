import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/config';
import { closeApp, createSalon, getApp, resetDb } from './helpers';

beforeAll(async () => {
  await resetDb();
  await getApp();
});
afterAll(closeApp);

describe('админ-панель сервиса', () => {
  it('доступна только email из ADMIN_EMAILS; обзор, салоны, продление', async () => {
    const admin = await createSalon('Admin');
    const other = await createSalon('Other');
    const adminEmail = (await admin.api.get('/auth/me')).body.data.user.email;
    const prev = env.ADMIN_EMAILS;
    env.ADMIN_EMAILS = `boss@example.ru, ${adminEmail.toUpperCase()}`;
    try {
      expect((await other.api.get('/admin/overview')).status).toBe(403);
      expect((await other.api.get('/auth/me')).body.data.isAdmin).toBe(false);
      expect((await admin.api.get('/auth/me')).body.data.isAdmin).toBe(true);

      const o = (await admin.api.get('/admin/overview')).body.data;
      expect(o.subscriptions.TRIAL).toBe(2);
      expect(o.signups.days7).toBe(2);
      expect(o.health).toHaveProperty('errors24h');

      const list = (await admin.api.get('/admin/tenants?q=Other')).body.data;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ name: 'Other', status: 'TRIAL', masters: 1 });
      // Данных клиентов в админке нет — только владелец салона
      expect(JSON.stringify(list)).not.toMatch(/customer|phone/i);

      const before = new Date(list[0].until).getTime();
      const ext = await admin.api.post(`/admin/tenants/${other.tenantId}/extend`, { days: 7 });
      expect(ext.status).toBe(200);
      expect(new Date(ext.body.data.trialEndsAt).getTime() - before).toBeGreaterThanOrEqual(7 * 86400_000 - 1000);
      expect((await other.api.post(`/admin/tenants/${admin.tenantId}/extend`, { days: 30 })).status).toBe(403);
    } finally {
      env.ADMIN_EMAILS = prev;
    }
  });
});
