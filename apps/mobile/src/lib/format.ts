export const rub = (kop: number) => `${Math.round(kop / 100).toLocaleString('ru-RU')} ₽`;
export const minutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} ч${m % 60 ? ` ${m % 60} мин` : ''}` : `${m} мин`);

/** Части даты в часовом поясе салона (Intl — работает и на Hermes, и в браузере). */
function parts(d: Date, tz: string) {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute') };
}

export const time = (iso: string, tz: string) => { const p = parts(new Date(iso), tz); return `${p.h}:${p.min}`; };

/** YYYY-MM-DD в поясе салона */
export const isoDay = (d: Date, tz: string) => { const p = parts(d, tz); return `${p.y}-${p.m}-${p.d}`; };
export const today = (tz: string) => isoDay(new Date(), tz);
export const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD_FULL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

export const dayLabel = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  return { wd: WD[d.getUTCDay()], n: d.getUTCDate() };
};
export const dayTitle = (day: string, tz: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  const t = today(tz);
  const prefix = day === t ? 'Сегодня' : day === addDays(t, 1) ? 'Завтра' : day === addDays(t, -1) ? 'Вчера' : WD_FULL[d.getUTCDay()];
  return `${prefix}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
export const dateTitle = (iso: string, tz: string) => { const day = isoDay(new Date(iso), tz); return `${dayTitle(day, tz)}, ${time(iso, tz)}`; };

/** Локальное время салона (день + ЧЧ:ММ) → ISO UTC */
export function zonedToIso(day: string, hhmm: string, tz: string): string {
  const guess = new Date(`${day}T${hhmm}:00Z`);
  const p = parts(guess, tz);
  const asIfUtc = Date.UTC(+p.y, +p.m - 1, +p.d, +p.h, +p.min);
  return new Date(guess.getTime() - (asIfUtc - guess.getTime())).toISOString();
}

export const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  SCHEDULED: { label: 'Записан', color: '#2F3BFF', bg: '#EEF0FF' },
  CONFIRMED: { label: 'Подтвердил', color: '#0F6B48', bg: '#DDF5EA' },
  ARRIVED: { label: 'Пришёл', color: '#7A1F45', bg: '#FFE3EB' },
  COMPLETED: { label: 'Завершён', color: '#3A3D5C', bg: '#ECEDF3' },
  CANCELLED: { label: 'Отменён', color: '#9A2A08', bg: '#FDECE7' },
  NO_SHOW: { label: 'Не пришёл', color: '#8A4500', bg: '#FFF0DC' },
};

export const phonePretty = (p: string) => {
  const m = p.match(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : p;
};
