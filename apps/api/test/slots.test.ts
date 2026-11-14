import { describe, expect, it } from 'vitest';
import { computeSlots, fitsSchedule, rangesOn, workIntervals } from '../src/bookings/slots';

const tz = 'Europe/Moscow';
const schedule = { '1': [['10:00', '13:00']] as [string, string][] }; // понедельник
const date = '2030-01-07'; // понедельник
const at = (hhmm: string) => new Date(`${date}T${hhmm}:00+03:00`).getTime();

describe('slots', () => {
  it('рабочие интервалы в часовом поясе салона', () => {
    expect(workIntervals(schedule, date, tz)).toEqual([{ start: at('10:00'), end: at('13:00') }]);
    expect(workIntervals(schedule, '2030-01-08', tz)).toEqual([]); // вторник — выходной
  });

  it('визит должен поместиться в рабочее время, перерыв — не пересекаться с занятым', () => {
    const slots = computeSlots({ date, tz, schedule, busy: [{ start: at('11:00'), end: at('11:30') }], durationMin: 60, bufferMin: 0, stepMin: 30, notBefore: 0 });
    expect(slots.map((s) => new Date(s).toISOString())).toEqual(
      [at('10:00'), at('11:30'), at('12:00')].map((s) => new Date(s).toISOString()),
    );
  });

  it('буфер после услуги учитывается', () => {
    const slots = computeSlots({ date, tz, schedule, busy: [{ start: at('11:00'), end: at('13:00') }], durationMin: 45, bufferMin: 15, stepMin: 15, notBefore: 0 });
    // 10:00–10:45 + 15 перерыв = 11:00 → ок; 10:15 + 60 = 11:15 → пересекается
    expect(slots).toEqual([at('10:00')]);
  });

  it('fitsSchedule', () => {
    expect(fitsSchedule(schedule, tz, new Date(at('12:00')), new Date(at('13:00')))).toBe(true);
    expect(fitsSchedule(schedule, tz, new Date(at('12:30')), new Date(at('13:30')))).toBe(false);
  });
});

describe('сменные графики и особые дни', () => {
  const cycle = { mode: 'cycle' as const, start: '2026-11-02', on: 2, off: 2, hours: [['10:00', '20:00']] as [string, string][] };
  const works = (s: Parameters<typeof rangesOn>[0], date: string) => rangesOn(s, date, new Date(`${date}T12:00:00Z`).getUTCDay() || 7).length > 0;

  it('2/2: два рабочих, два выходных — и в прошлое от даты начала', () => {
    const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
    expect(days.map((d) => works(cycle, d))).toEqual([true, true, false, false, true, true, false]);
    expect(works(cycle, '2026-11-01')).toBe(false);
    expect(works(cycle, '2026-10-31')).toBe(false);
    expect(works(cycle, '2026-10-30')).toBe(true);
  });

  it('особый день важнее графика; старый формат по дням недели работает как раньше', () => {
    const s = { ...cycle, overrides: { '2026-11-02': [], '2026-11-04': [['12:00', '16:00']] as [string, string][] } };
    expect(works(s, '2026-11-02')).toBe(false);
    expect(rangesOn(s, '2026-11-04', 3)).toEqual([['12:00', '16:00']]);
    const legacy = { '1': [['10:00', '20:00']] as [string, string][] };
    expect(works(legacy, '2026-11-02')).toBe(true); // понедельник
    expect(works(legacy, '2026-11-03')).toBe(false);
    const week = { mode: 'week' as const, week: legacy, overrides: { '2026-11-09': [] } };
    expect(works(week, '2026-11-02')).toBe(true);
    expect(works(week, '2026-11-09')).toBe(false);
  });

  it('свободное время считается по сменному графику (с переходом через смену времени — без сдвигов)', () => {
    const iv = workIntervals(cycle, '2026-11-06', 'Europe/Moscow');
    expect(iv).toHaveLength(1);
    expect(new Date(iv[0].start).toISOString()).toBe('2026-11-06T07:00:00.000Z');
    expect(workIntervals(cycle, '2026-11-04', 'Europe/Moscow')).toEqual([]);
  });
});
