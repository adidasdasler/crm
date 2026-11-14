import { z } from 'zod';
import { normalizePhone } from './phone';

export const uuid = z.string().uuid();
export const phone = z.string().transform((v, ctx) => {
  const p = normalizePhone(v);
  if (!p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Некорректный номер телефона' });
  return p ?? '';
});
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Формат ЧЧ:ММ');
/** { "1": [["10:00","19:00"]], ..., "7": [] } */
export const weekSchedule = z.partialRecord(
  z.enum(['1', '2', '3', '4', '5', '6', '7']),
  z.array(z.tuple([hhmm, hhmm]).refine(([a, b]) => a < b, 'Начало должно быть раньше конца')),
);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата ГГГГ-ММ-ДД');
const ranges = z.array(z.tuple([hhmm, hhmm]).refine(([a, b]) => a < b, 'Начало должно быть раньше конца')).max(4);
const overrides = z.record(isoDate, ranges).refine((o) => Object.keys(o).length <= 400, 'Слишком много особых дней').optional();
/**
 * График мастера: старый формат (дни недели), по дням недели с особыми днями
 * или сменный (2/2, 1/1, 3/3 и любой свой: on рабочих, off выходных начиная с start).
 */
export const scheduleSchema = z.union([
  z.object({ mode: z.literal('week'), week: weekSchedule, overrides }),
  z.object({
    mode: z.literal('cycle'), start: isoDate,
    on: z.number().int().min(1).max(14), off: z.number().int().min(0).max(14),
    hours: ranges.min(1, 'Укажите часы работы'), overrides,
  }),
  weekSchedule,
]);
export const DEFAULT_SCHEDULE = {
  '1': [['10:00', '20:00']], '2': [['10:00', '20:00']], '3': [['10:00', '20:00']],
  '4': [['10:00', '20:00']], '5': [['10:00', '20:00']], '6': [['10:00', '18:00']], '7': [],
};
