import { DateTime } from 'luxon';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unsubscribeUrl, winbackTick } from '../src/marketing/winback';
import { api, clearOutbox, closeApp, createSalon, fakeMessengers, getApp, outbox, resetDb, system } from './helpers';

beforeAll(async () => {
  await resetDb();
  await getApp();
  await fakeMessengers();
});
afterAll(closeApp);

/** Полдень по Москве — в окне отправки 11–20 */
const noon = (d = DateTime.now()) => d.setZone('Europe/Moscow').set({ hour: 12, minute: 0 }).toJSDate();

describe('возврат клиентов', () => {
  it('«давно не были» и день рождения — только с согласием, раз за паузу и раз в год; отписка', async () => {
    const s = await createSalon('Winback');
    await s.api.patch('/tenant', { settings: { winbackEnabled: true, winbackDays: 30, birthdayEnabled: true, birthdayText: 'С днём рождения, {имя}! Скидка 10% в «{салон}»' } });
    const now = noon();
    const old = DateTime.fromJSDate(now).minus({ days: 40 }).toJSDate();
    const md = DateTime.fromJSDate(now).setZone('Europe/Moscow');
    const mk = (name: string, email: string, data: object) => system.customer.create({ data: { tenantId: s.tenantId, name, phone: `+7999${Math.floor(Math.random() * 1e7).toString().padStart(7, '0')}`, email, ...data } });
    const lapsed = await mk('Анна Иванова', 'anna@ex.ru', { marketingConsent: true, lastVisitAt: old });
    await mk('Без согласия', 'no@ex.ru', { marketingConsent: false, lastVisitAt: old });
    await mk('Недавно была', 'recent@ex.ru', { marketingConsent: true, lastVisitAt: DateTime.fromJSDate(now).minus({ days: 5 }).toJSDate() });
    await mk('Именинница', 'bday@ex.ru', { marketingConsent: true, birthDate: new Date(`1990-${md.toFormat('MM-dd')}T00:00:00Z`), lastVisitAt: DateTime.fromJSDate(now).minus({ days: 2 }).toJSDate() });

    // Ночью не пишем
    clearOutbox();
    expect(await winbackTick(system, DateTime.fromJSDate(now).set({ hour: 23 }).toJSDate())).toEqual({ winback: 0, birthday: 0 });

    expect(await winbackTick(system, now)).toEqual({ winback: 1, birthday: 1 });
    const to = outbox.email.map((m) => m.to).sort();
    expect(to).toEqual(['anna@ex.ru', 'bday@ex.ru']);
    expect(outbox.email.find((m) => m.to === 'anna@ex.ru')!.text).toContain('Анна, давно не виделись');
    expect(outbox.email.find((m) => m.to === 'bday@ex.ru')!.text).toContain('С днём рождения, Именинница! Скидка 10% в «Winback»');
    expect(outbox.email[0].text).toContain('/unsubscribe/');

    // Повторно — не пишем
    expect(await winbackTick(system, now)).toEqual({ winback: 0, birthday: 0 });

    // Отписка по ссылке из письма
    const path = unsubscribeUrl(lapsed.id).replace(/^.*\/v1/, '');
    const page = await api().get(path);
    expect(page.text).toContain('Вы отписались');
    expect((await system.customer.findUniqueOrThrow({ where: { id: lapsed.id } })).marketingConsent).toBe(false);
    expect((await api().get(path.replace(/[^/]+$/, 'bad-signature-0000000000'))).text).toContain('недействительна');

    const aud = (await s.api.get('/marketing/audience')).body.data;
    expect(aud).toMatchObject({ total: 4, consent: 2, reachable: 2 });
  });
});
