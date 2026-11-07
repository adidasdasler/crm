import { describe, expect, it } from 'vitest';
import { computeSlots, fitsSchedule, workIntervals } from '../src/bookings/slots';

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
