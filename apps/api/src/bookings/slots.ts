import { DateTime } from 'luxon';

/** Полуинтервал [start, end) в миллисекундах UTC. */
export type Interval = { start: number; end: number };
export type Ranges = [string, string][];
/** Дни недели: 1 = понедельник … 7 = воскресенье */
export type WeekDays = Partial<Record<'1' | '2' | '3' | '4' | '5' | '6' | '7', Ranges>>;
/** Особые дни: дата → часы (пустой список — выходной). Важнее основного графика. */
export type Overrides = Record<string, Ranges>;
/**
 * График мастера:
 *  - старый формат — просто дни недели { "1": [["10:00","20:00"]], … };
 *  - { mode: "week", week, overrides } — по дням недели с особыми днями;
 *  - { mode: "cycle", start, on, off, hours, overrides } — сменный: on рабочих, off выходных подряд
 *    начиная с даты start (2/2, 1/1, 3/3, 5/2 и т. п.).
 */
export type Schedule =
  | WeekDays
  | { mode: 'week'; week: WeekDays; overrides?: Overrides }
  | { mode: 'cycle'; start: string; on: number; off: number; hours: Ranges; overrides?: Overrides };
/** @deprecated оставлено для совместимости импорта */
export type WeekSchedule = Schedule;

/** Часы работы по графику на дату (без перевода во время) */
export function rangesOn(schedule: Schedule, date: string, weekday: number): Ranges {
  const s = schedule as Record<string, unknown>;
  const overrides = s.overrides as Overrides | undefined;
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, date)) return overrides[date] ?? [];
  if (s.mode === 'cycle') {
    const c = schedule as Extract<Schedule, { mode: 'cycle' }>;
    const period = c.on + c.off;
    if (period <= 0) return [];
    // Разница в днях по календарю (без часовых поясов и перехода на летнее время)
    const diff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${c.start}T00:00:00Z`)) / 86_400_000);
    return ((diff % period) + period) % period < c.on ? c.hours : [];
  }
  const week = (s.mode === 'week' ? (s.week as WeekDays) : (schedule as WeekDays)) ?? {};
  return week[String(weekday) as keyof WeekDays] ?? [];
}

const MIN = 60_000;

/** Рабочие интервалы мастера на дату (YYYY-MM-DD) в часовом поясе салона. */
export function workIntervals(schedule: Schedule, date: string, tz: string): Interval[] {
  const day = DateTime.fromISO(date, { zone: tz });
  if (!day.isValid || !schedule) return [];
  const ranges = rangesOn(schedule, date, day.weekday);
  return ranges.map(([from, to]) => {
    const [fh, fm] = from.split(':').map(Number);
    const [th, tm] = to.split(':').map(Number);
    return {
      start: day.set({ hour: fh, minute: fm, second: 0, millisecond: 0 }).toMillis(),
      end: day.set({ hour: th, minute: tm, second: 0, millisecond: 0 }).toMillis(),
    };
  });
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/**
 * Свободные слоты. Визит [s, s+duration) должен целиком помещаться в рабочий интервал;
 * занятый у мастера отрезок [s, s+duration+buffer) не должен пересекаться с busy.
 */
export function computeSlots(p: {
  date: string;
  tz: string;
  schedule: WeekSchedule;
  busy: Interval[];
  durationMin: number;
  bufferMin: number;
  stepMin: number;
  notBefore: number;
}): number[] {
  const out: number[] = [];
  const step = p.stepMin * MIN;
  for (const w of workIntervals(p.schedule, p.date, p.tz)) {
    for (let s = w.start; s + p.durationMin * MIN <= w.end; s += step) {
      if (s < p.notBefore) continue;
      const blocked = { start: s, end: s + (p.durationMin + p.bufferMin) * MIN };
      if (!p.busy.some((b) => overlaps(blocked, b))) out.push(s);
    }
  }
  return out;
}

/** Попадает ли визит [start, end) в рабочее время мастера (визит не может переходить через полночь). */
export function fitsSchedule(schedule: WeekSchedule, tz: string, start: Date, end: Date): boolean {
  const date = DateTime.fromJSDate(start, { zone: tz }).toISODate()!;
  return workIntervals(schedule, date, tz).some(
    (w) => start.getTime() >= w.start && end.getTime() <= w.end,
  );
}

/** Границы суток даты в поясе салона → UTC. */
export function dayBounds(date: string, tz: string): { from: Date; to: Date } {
  const d = DateTime.fromISO(date, { zone: tz }).startOf('day');
  return { from: d.toJSDate(), to: d.plus({ days: 1 }).toJSDate() };
}
