import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseDuration } from '../src/customers/import-file';
import { closeApp, createSalon, getApp, resetDb, system } from './helpers';

const fx = (f: string) => join(__dirname, 'fixtures', f);
beforeAll(async () => {
  await resetDb();
  await getApp();
});
afterAll(closeApp);

describe('перенос из другой программы', () => {
  it('клиенты из XLSX (YCLIENTS) и CSV в Windows-1251 (DIKIDI): предпросмотр, загрузка, без дублей', async () => {
    const s = await createSalon('Import');
    const preview = await s.api.upload('/import?kind=customers&dryRun=1', fx('yclients-clients.xlsx'));
    expect(preview.status).toBe(201);
    expect(preview.body.data).toMatchObject({ source: 'YCLIENTS', total: 2, invalid: 1 });
    expect(preview.body.data.sample[0]).toMatchObject({
      name: 'Анна Петрова', phone: '+79161112233', email: 'anna@example.ru', tags: ['VIP', 'Маникюр'],
      birthDate: '1990-02-01', visits: 12, spent: 2450000, lastVisit: '2026-10-30', notes: 'Любит нюд',
    });
    expect(preview.body.data.sample[1]).toMatchObject({ name: 'Мария', phone: '+79162223344' });
    expect(await system.customer.count({ where: { tenantId: s.tenantId } })).toBe(0);

    const done = await s.api.upload('/import?kind=customers', fx('yclients-clients.xlsx'));
    expect(done.body.data).toMatchObject({ created: 2, skipped: 0 });
    const csv = await s.api.upload('/import?kind=customers', fx('dikidi-clients.csv'));
    // Анна уже есть — не дублируем
    expect(csv.body.data).toMatchObject({ created: 1, skipped: 1 });
    const olga = await system.customer.findFirstOrThrow({ where: { tenantId: s.tenantId, phone: '+79035556677' } });
    expect(olga).toMatchObject({ name: 'Смирнова Ольга', notes: 'Аллергия на "лак"; осторожно' });
  });

  it('услуги с категориями и длительностью «1 ч 30 мин» сразу доступны мастерам', async () => {
    const s = await createSalon('ImportSvc');
    const r = await s.api.upload('/import?kind=services', fx('services.xlsx'));
    expect(r.body.data).toMatchObject({ created: 3 });
    const list = await system.service.findMany({ where: { tenantId: s.tenantId, name: { not: 'Стрижка' } }, include: { category: true, resources: true }, orderBy: { name: 'asc' } });
    expect(list.map((x) => [x.name, x.price, x.duration, x.category?.name, x.resources.length])).toEqual([
      ['Коррекция бровей', 90000, 45, 'Брови', 1],
      ['Маникюр без покрытия', 120000, 90, 'Маникюр', 1],
      ['Маникюр с покрытием', 220000, 120, 'Маникюр', 1],
    ]);
    // Повторная загрузка не дублирует
    expect((await s.api.upload('/import?kind=services', fx('services.xlsx'))).body.data.created).toBe(0);
  });

  it('понятная ошибка, если нет нужных колонок; длительность в разных форматах', async () => {
    const s = await createSalon('ImportBad');
    const r = await s.api.upload('/import?kind=customers', Buffer.from('a;b\n1;2\n'), 'x.csv');
    expect(r.status).toBe(422);
    expect(r.body.error.message).toContain('Имя, Телефон');
    expect([parseDuration('90'), parseDuration('1:30'), parseDuration('1,5 ч'), parseDuration(0.0625)]).toEqual([90, 90, 90, 90]);
  });
});
