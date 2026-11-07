import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processDueReminders } from '../src/reminders/process';
import { api, clearOutbox, closeApp, createSalon, fakeMessengers, getApp, maxUpdate, outbox, resetDb, system, tgUpdate, tomorrowAt, tomorrowDate, vkEvent } from './helpers';

let blocked = false;
beforeAll(async () => {
  await resetDb();
  await getApp();
  await fakeMessengers({ telegramBlocked: () => blocked });
});
afterAll(closeApp);

const minutesBefore = (iso: string, min: number) => new Date(+new Date(iso) - min * 60_000);

async function bookOnline(slug: string, serviceId: string, time: string, phone: string, email?: string) {
  const startsAt = tomorrowAt(time, 2);
  const r = await api().post(`/public/${slug}/book`, { serviceIds: [serviceId], resourceId: null, startsAt, name: 'Клиент', phone, email, consent: true });
  expect(r.status).toBe(201);
  return { ...r.body.data, startsAt } as { id: string; manageToken: string; telegramUrl: string; startsAt: string; messengers: Record<string, string> };
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

  it('без мессенджеров — письмо на email со ссылкой управления; без контактов — FAILED', async () => {
    const s = await createSalon('Mail');
    const b = await bookOnline(s.slug, s.serviceId, '15:00', '+79990001002', 'client@test.ru');
    expect(b.messengers).toEqual({
      telegram: `https://t.me/salon_test_bot?start=b_${b.manageToken}`,
      max: `https://max.ru/mioflow_test_bot?start=b_${b.manageToken}`,
      vk: `https://vk.me/mioflow_test?ref=b_${b.manageToken}`,
    });
    clearOutbox();
    await processDueReminders(system, minutesBefore(b.startsAt, 24 * 60 - 1));
    expect(outbox.email).toHaveLength(1);
    expect(outbox.email[0].to).toBe('client@test.ru');
    expect(outbox.email[0].text).toContain(`/b/${s.slug}/manage/${b.manageToken}`);
    expect(outbox.email[0].text).not.toContain('<b>');
    const one = await system.reminder.findFirstOrThrow({ where: { bookingId: b.id, type: 'BEFORE_24H' } });
    expect(one).toMatchObject({ status: 'SENT', channel: 'EMAIL' });

    const n = await bookOnline(s.slug, s.serviceId, '18:00', '+79990001012');
    await processDueReminders(system, minutesBefore(n.startsAt, 24 * 60 - 1));
    const none = await system.reminder.findFirstOrThrow({ where: { bookingId: n.id, type: 'BEFORE_24H' } });
    expect(none.status).toBe('FAILED');
    expect(none.lastError).toContain('no channel');
  });

  it('MAX: привязка по ссылке, напоминание с кнопками и подтверждение', async () => {
    const s = await createSalon('Max');
    const b = await bookOnline(s.slug, s.serviceId, '12:00', '+79990001006');
    expect((await maxUpdate({ update_type: 'bot_started', user: { user_id: 31 }, payload: `b_${b.manageToken}` }, 'wrong')).status).toBe(403);
    clearOutbox();
    await maxUpdate({ update_type: 'bot_started', user: { user_id: 31 }, payload: `b_${b.manageToken}` });
    expect((await system.customer.findFirstOrThrow({ where: { phone: '+79990001006' } })).maxUserId).toBe('31');
    expect(outbox.max[0].path).toBe('/messages?user_id=31');
    expect(outbox.max[0].body.text).toContain('Вы записаны');

    clearOutbox();
    await processDueReminders(system, minutesBefore(b.startsAt, 24 * 60 - 1));
    const msg = outbox.max.find((m) => m.path.startsWith('/messages'))!;
    expect(msg.body.format).toBe('html');
    const btns = msg.body.attachments[0].payload.buttons.flat().filter((x: any) => x.type === 'callback').map((x: any) => x.payload);
    expect(btns).toEqual([`c:${b.id}`, `x:${b.id}`]);
    expect((await system.reminder.findFirstOrThrow({ where: { bookingId: b.id, type: 'BEFORE_24H' } })).channel).toBe('MAX');

    // Чужой пользователь MAX не может подтвердить
    await maxUpdate({ update_type: 'message_callback', callback: { callback_id: 'cb0', payload: `c:${b.id}`, user: { user_id: 99 } } });
    expect((await system.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('SCHEDULED');
    await maxUpdate({ update_type: 'message_callback', callback: { callback_id: 'cb1', payload: `c:${b.id}`, user: { user_id: 31 } } });
    expect((await system.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('CONFIRMED');
    expect(outbox.max.some((m) => m.path === '/answers?callback_id=cb1')).toBe(true);
  });

  it('ВКонтакте: подтверждение сервера, привязка через ref и отмена кнопкой', async () => {
    const s = await createSalon('Vk');
    const conf = await api().post('/webhooks/vk', { type: 'confirmation', group_id: 1 });
    expect(conf.text).toBe('vk-confirm-123');
    const b = await bookOnline(s.slug, s.serviceId, '14:00', '+79990001007');
    expect((await vkEvent({ type: 'message_new', object: { message: { from_id: 51, ref: `b_${b.manageToken}` } } }, 'bad')).status).toBe(403);
    clearOutbox();
    const ok = await vkEvent({ type: 'message_new', object: { message: { from_id: 51, ref: `b_${b.manageToken}` } } });
    expect(ok.text).toBe('ok');
    expect((await system.customer.findFirstOrThrow({ where: { phone: '+79990001007' } })).vkUserId).toBe('51');
    expect(String(outbox.vk[0].params.message)).toContain('Вы записаны');

    await vkEvent({ type: 'message_event', object: { user_id: 51, peer_id: 51, event_id: 'e1', payload: { d: `x:${b.id}` } } });
    expect((await system.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('CANCELLED');
    expect(outbox.vk.some((m) => m.method === 'messages.sendMessageEventAnswer')).toBe(true);
  });

  it('клиент заблокировал бота → отвязка Telegram и напоминание в следующий канал (VK)', async () => {
    const s = await createSalon('Blocked');
    const b = await bookOnline(s.slug, s.serviceId, '11:00', '+79990001003');
    await tgUpdate({ message: { chat: { id: 777 }, text: `/start b_${b.manageToken}` } });
    await vkEvent({ type: 'message_new', object: { message: { from_id: 52, ref: `b_${b.manageToken}` } } });
    blocked = true;
    clearOutbox();
    await processDueReminders(system, minutesBefore(b.startsAt, 24 * 60 - 1));
    blocked = false;
    expect(outbox.vk.filter((m) => m.method === 'messages.send')).toHaveLength(1);
    const c = await system.customer.findFirstOrThrow({ where: { phone: '+79990001003' } });
    expect(c.telegramChatId).toBeNull();
    expect(c.vkUserId).toBe('52');
    expect((await system.reminder.findFirstOrThrow({ where: { bookingId: b.id, type: 'BEFORE_24H' } })).channel).toBe('VK');
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
