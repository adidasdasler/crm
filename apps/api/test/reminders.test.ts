import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processDueReminders } from '../src/reminders/process';
import { api, closeApp, createSalon, fakeMessengers, getApp, outbox, resetDb, system, tgUpdate, tomorrowAt, tomorrowDate } from './helpers';

let blocked = false;
beforeAll(async () => {
  await resetDb();
  await getApp();
  await fakeMessengers({ telegramBlocked: () => blocked });
});
afterAll(closeApp);

const minutesBefore = (iso: string, min: number) => new Date(+new Date(iso) - min * 60_000);

async function bookOnline(slug: string, serviceId: string, time: string, phone: string) {
  const startsAt = tomorrowAt(time, 2);
  const r = await api().post(`/public/${slug}/book`, { serviceIds: [serviceId], resourceId: null, startsAt, name: 'Клиент', phone, consent: true });
  expect(r.status).toBe(201);
  return { ...r.body.data, startsAt } as { id: string; manageToken: string; telegramUrl: string; startsAt: string };
}

describe('напоминания и Telegram-бот', () => {
  it('клиент подключает Telegram, получает напоминания с кнопками и подтверждает визит', async () => {
    const s = await createSalon('Remind');
    const b = await bookOnline(s.slug, s.serviceId, '12:00', '+79990001001');
    expect(b.telegramUrl).toBe(`https://t.me/salon_test_bot?start=b_${b.manageToken}`);
    expect(await system.reminder.count({ where: { bookingId: b.id } })).toBe(2);

    // Неверный секрет вебхука
    expect((await tgUpdate({ message: { chat: { id: 555 }, text: `/start b_${b.manageToken}` } }, 'wrong')).status).toBe(403);

    outbox.telegram.length = 0;
    expect((await tgUpdate({ message: { chat: { id: 555 }, text: `/start b_${b.manageToken}` } })).status).toBe(200);
    const customer = await system.customer.findFirstOrThrow({ where: { phone: '+79990001001' } });
    expect(customer.telegramChatId).toBe('555');
    expect(outbox.telegram[0].body.text).toContain('Вы записаны');

    // За сутки: только напоминание за 24 ч
    outbox.telegram.length = 0;
    let r = await processDueReminders(system, minutesBefore(b.startsAt, 24 * 60 - 1));
    expect(r.sent).toBe(1);
    const msg = outbox.telegram.find((m) => m.method === 'sendMessage')!;
    expect(msg.body.chat_id).toBe('555');
    expect(msg.body.text).toContain('Пора к мастеру');
    const buttons = msg.body.reply_markup.inline_keyboard.flat().map((x: any) => x.callback_data).filter(Boolean);
    expect(buttons).toEqual([`c:${b.id}`, `x:${b.id}`]);

    // Чужой чат не может нажать кнопку
    await tgUpdate({ callback_query: { id: 'q0', data: `c:${b.id}`, message: { chat: { id: 999 }, message_id: 1 } } });
    expect((await system.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('SCHEDULED');

    await tgUpdate({ callback_query: { id: 'q1', data: `c:${b.id}`, message: { chat: { id: 555 }, message_id: 1 } } });
    expect((await system.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('CONFIRMED');

    // За 2 часа — второе напоминание (Telegram бесплатный, поэтому шлём и подтвердившим)
    r = await processDueReminders(system, minutesBefore(b.startsAt, 119));
    expect(r.sent).toBe(1);
    const reminders = await system.reminder.findMany({ where: { bookingId: b.id } });
    expect(reminders.every((x) => x.status === 'SENT' && x.channel === 'TELEGRAM')).toBe(true);
  });

  it('без Telegram — SMS со ссылкой; подтвердившему 2-часовую SMS не шлём (экономия)', async () => {
    const s = await createSalon('Sms');
    const b = await bookOnline(s.slug, s.serviceId, '15:00', '+79990001002');
    outbox.sms.length = 0;
    await processDueReminders(system, minutesBefore(b.startsAt, 24 * 60 - 1));
    expect(outbox.sms).toHaveLength(1);
    expect(outbox.sms[0].phone).toBe('+79990001002');
    expect(outbox.sms[0].text).toContain(`/b/${s.slug}/manage/${b.manageToken}`);

    await api().post(`/public/${s.slug}/manage/${b.manageToken}/confirm`);
    await processDueReminders(system, minutesBefore(b.startsAt, 119));
    expect(outbox.sms).toHaveLength(1);
    const two = await system.reminder.findFirstOrThrow({ where: { bookingId: b.id, type: 'BEFORE_2H' } });
    expect(two.status).toBe('CANCELLED');
  });

  it('клиент заблокировал бота → SMS и отвязка Telegram; лимит SMS по тарифу', async () => {
    const s = await createSalon('Blocked');
    const b = await bookOnline(s.slug, s.serviceId, '11:00', '+79990001003');
    await tgUpdate({ message: { chat: { id: 777 }, text: `/start b_${b.manageToken}` } });
    blocked = true;
    outbox.sms.length = 0;
    await processDueReminders(system, minutesBefore(b.startsAt, 24 * 60 - 1));
    blocked = false;
    expect(outbox.sms).toHaveLength(1);
    expect((await system.customer.findFirstOrThrow({ where: { phone: '+79990001003' } })).telegramChatId).toBeNull();

    // Лимит: на тарифе осталось 0 SMS
    const plan = await system.plan.create({ data: { code: `T${Date.now()}`, name: 'Тест', priceMonthly: 0, priceYearly: 0, limits: { masters: 5, smsPerMonth: 1 }, isActive: false } });
    await system.subscription.update({ where: { tenantId: s.tenantId }, data: { planId: plan.id } });
    await processDueReminders(system, minutesBefore(b.startsAt, 119));
    const two = await system.reminder.findFirstOrThrow({ where: { bookingId: b.id, type: 'BEFORE_2H' } });
    expect(two.status).toBe('FAILED');
    expect(two.lastError).toContain('sms limit');
  });

  it('отмена кнопкой в Telegram: отменяет запись и будущие напоминания, мастер получает уведомление', async () => {
    const s = await createSalon('Cancel');
    // Сотрудник подключает Telegram
    const link = await s.api.post('/me/telegram');
    const token = new URL(link.body.data.url).searchParams.get('start')!;
    await tgUpdate({ message: { chat: { id: 4242 }, text: `/start ${token}` } });
    expect((await s.api.get('/auth/me')).body.data.telegramLinked).toBe(true);

    outbox.telegram.length = 0;
    const b = await bookOnline(s.slug, s.serviceId, '16:00', '+79990001004');
    await new Promise((r) => setTimeout(r, 200));
    expect(outbox.telegram.some((m) => m.body.chat_id === '4242' && m.body.text.includes('Онлайн-запись'))).toBe(true);

    await tgUpdate({ message: { chat: { id: 888 }, text: `/start b_${b.manageToken}` } });
    await tgUpdate({ callback_query: { id: 'q2', data: `x:${b.id}`, message: { chat: { id: 888 }, message_id: 5 } } });
    expect((await system.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('CANCELLED');
    const rem = await system.reminder.findMany({ where: { bookingId: b.id } });
    expect(rem.every((x) => x.status === 'CANCELLED')).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    expect(outbox.telegram.some((m) => m.body.chat_id === '4242' && m.body.text.includes('отменил'))).toBe(true);
  });

  it('у записей, созданных сотрудником, тоже есть ссылка управления', async () => {
    const s = await createSalon('Staff');
    const bk = await s.api.post('/bookings', { customer: { name: 'К', phone: '+79990001005' }, resourceId: s.resourceId, serviceIds: [s.serviceId], startsAt: tomorrowAt('13:00') });
    const row = await system.booking.findUniqueOrThrow({ where: { id: bk.body.data.id } });
    expect(row.manageTokenHash).toBeTruthy();
    expect(tomorrowDate()).toBeTruthy();
  });
});
