import type { Week } from './types';

/** Те же правила, что на сервере (apps/api/src/bookings/slots.ts → rangesOn) */
export type Ranges = [string, string][];
export type Overrides = Record<string, Ranges>;
export type WeekMode = { mode: 'week'; week: Week; overrides?: Overrides };
export type CycleMode = { mode: 'cycle'; start: string; on: number; off: number; hours: Ranges; overrides?: Overrides };
export type Schedule = Week | WeekMode | CycleMode;

export const DEFAULT_WEEK: Week = { '1': [['10:00', '20:00']], '2': [['10:00', '20:00']], '3': [['10:00', '20:00']], '4': [['10:00', '20:00']], '5': [['10:00', '20:00']], '6': [['10:00', '18:00']], '7': [] };

/** Привести любой формат к редактируемому виду */
export function normalize(s: Schedule | null | undefined): WeekMode | CycleMode {
  if (!s) return { mode: 'week', week: DEFAULT_WEEK };
  if ((s as WeekMode).mode === 'week' || (s as CycleMode).mode === 'cycle') return s as WeekMode | CycleMode;
  return { mode: 'week', week: s as Week };
}

/** YYYY-MM-DD → день недели 1..7 (пн = 1) */
export const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay() || 7;

export function rangesOn(s: Schedule, date: string): Ranges {
  const n = normalize(s);
  if (n.overrides && Object.prototype.hasOwnProperty.call(n.overrides, date)) return n.overrides[date] ?? [];
  if (n.mode === 'cycle') {
    const period = n.on + n.off;
    if (period <= 0) return [];
    const diff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${n.start}T00:00:00Z`)) / 86_400_000);
    return ((diff % period) + period) % period < n.on ? n.hours : [];
  }
  return n.week[String(weekdayOf(date)) as keyof Week] ?? [];
}

const WD = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** Короткое описание для списка мастеров: «2/2 · 10:00–20:00», «Пн–Пт 10:00–20:00» */
export function scheduleText(s: Schedule | null | undefined): string {
  const n = normalize(s);
  if (n.mode === 'cycle') return `Сменный ${n.on}/${n.off} · ${n.hours.map(([a, b]) => `${a}–${b}`).join(', ')}`;
  const days = (['1', '2', '3', '4', '5', '6', '7'] as const).filter((d) => n.week[d]?.length);
  if (!days.length) return 'Нет рабочих дней';
  // Подряд идущие дни — диапазоном: Пн–Пт, Сб
  const groups: string[] = [];
  let i = 0;
  while (i < days.length) {
    let j = i;
    while (j + 1 < days.length && +days[j + 1] === +days[j] + 1) j++;
    groups.push(j > i + 1 ? `${WD[+days[i]]}–${WD[+days[j]]}` : days.slice(i, j + 1).map((d) => WD[+d]).join(', '));
    i = j + 1;
  }
  return groups.join(', ');
}

/**
 * Время вводится одними цифрами, двоеточие ставится само: «1» → «1», «10» → «10», «100» → «10:0», «1000» → «10:00».
 * Двоеточие, набранное вручную, тоже не мешает.
 */
export function formatTime(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`;
}

/** Довести недописанное время при выходе из поля: «9» → «09:00», «18» → «18:00», «93:0» (набрали 930) → «09:30» */
export function finishTime(value: string): string {
  const d = value.replace(/\D/g, '');
  if (!d) return value;
  if (d.length <= 2) return +d <= 23 ? `${d.padStart(2, '0')}:00` : value;
  if (d.length === 3) return +d.slice(0, 2) <= 23 && +d[2] <= 5 ? `${d.slice(0, 2)}:${d[2]}0` : `0${d[0]}:${d.slice(1)}`;
  return `${d.slice(0, 2)}:${d.slice(2)}`;
}
export const validTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

/** Особые дни в прошлом не нужны — не храним */
export function pruneOverrides(o: Overrides | undefined, today: string): Overrides | undefined {
  if (!o) return undefined;
  const rest = Object.fromEntries(Object.entries(o).filter(([d]) => d >= today));
  return Object.keys(rest).length ? rest : undefined;
}
