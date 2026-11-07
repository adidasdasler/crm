import { DateTime } from 'luxon';
import { esc } from '../notify/telegram';

export type ReminderCtx = {
  type: 'BEFORE_24H' | 'BEFORE_2H' | 'AFTER_VISIT';
  startsAt: Date;
  tz: string;
  salon: { name: string; address: string | null; phone: string | null };
  services: string[];
  master: string;
  customerName: string;
  url: string;
};

/** «сегодня», «завтра» или «9 ноября» — в часовом поясе салона */
export function whenText(startsAt: Date, tz: string, now = new Date()) {
  const d = DateTime.fromJSDate(startsAt, { zone: tz }).setLocale('ru');
  const today = DateTime.fromJSDate(now, { zone: tz }).startOf('day');
  const diff = Math.round(d.startOf('day').diff(today, 'days').days);
  const day = diff === 0 ? 'сегодня' : diff === 1 ? 'завтра' : d.toFormat('d MMMM');
  return { day, time: d.toFormat('HH:mm'), short: d.toFormat('dd.MM') };
}

export function telegramText(c: ReminderCtx, now = new Date()) {
  const w = whenText(c.startsAt, c.tz, now);
  // Голос бренда MioFlow: короткая фраза-действие в заголовке
  const head = c.type === 'BEFORE_2H' ? `<b>Ждём вас ${w.day} в ${w.time}</b>` : `<b>Пора к мастеру: ${w.day} в ${w.time}</b>`;
  return [
    head,
    '',
    esc(c.services.join(', ')),
    `Мастер: ${esc(c.master)}`,
    '',
    `<b>${esc(c.salon.name)}</b>`,
    c.salon.address ? esc(c.salon.address) : null,
    c.salon.phone ? esc(c.salon.phone) : null,
  ].filter((x) => x !== null).join('\n');
}

export function smsText(c: ReminderCtx, now = new Date()) {
  const w = whenText(c.startsAt, c.tz, now);
  const when = w.day === 'сегодня' || w.day === 'завтра' ? `${w.day} в ${w.time}` : `${w.short} в ${w.time}`;
  return `${c.salon.name}: ждём вас ${when}. Подтвердить или отменить: ${c.url}`;
}
