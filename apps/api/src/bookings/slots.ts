import { DateTime } from 'luxon';

/** Полуинтервал [start, end) в миллисекундах UTC. */
export type Interval = { start: number; end: number };
export type WeekSchedule = Partial<Record<'1' | '2' | '3' | '4' | '5' | '6' | '7', [string, string][]>>;

const MIN = 60_000;

/** Рабочие интервалы мастера на дату (YYYY-MM-DD) в часовом поясе салона. */
export function workIntervals(schedule: WeekSchedule, date: string, tz: string): Interval[] {
  const day = DateTime.fromISO(date, { zone: tz });
  if (!day.isValid) return [];
  const ranges = schedule[String(day.weekday) as keyof WeekSchedule] ?? [];
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
