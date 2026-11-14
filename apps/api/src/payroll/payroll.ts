/**
 * Зарплата мастеров. Правило у каждого мастера своё и складывается из частей:
 *  - процент от стоимости оказанных услуг (завершённые визиты);
 *  - оплата за смену (день, в который были завершённые визиты);
 *  - оклад в месяц (за период считается пропорционально дням);
 *  - по желанию — сначала вычесть себестоимость материалов, потом считать процент.
 * Все суммы — в копейках.
 */
import { z } from 'zod';

export const payRuleSchema = z.object({
  percent: z.number().min(0).max(100).default(0),
  perShift: z.number().int().min(0).max(10_000_000).default(0),
  monthly: z.number().int().min(0).max(100_000_000).default(0),
  deductMaterials: z.boolean().default(false),
});
export type PayRule = z.infer<typeof payRuleSchema>;
export const readPayRule = (v: unknown): PayRule => payRuleSchema.catch(payRuleSchema.parse({})).parse(v ?? {});

export type MasterPay = {
  resourceId: string; name: string; color: string; rule: PayRule;
  visits: number; revenue: number; materials: number; shifts: number;
  fromPercent: number; fromShifts: number; fromMonthly: number; total: number;
};

export function calcPay(
  m: { id: string; name: string; color: string; payRule: unknown },
  visits: { price: number; day: string; materials: number }[],
  periodDays: number,
): MasterPay {
  const rule = readPayRule(m.payRule);
  const revenue = visits.reduce((s, v) => s + v.price, 0);
  const materials = visits.reduce((s, v) => s + v.materials, 0);
  const shifts = new Set(visits.map((v) => v.day)).size;
  const base = Math.max(0, revenue - (rule.deductMaterials ? materials : 0));
  const fromPercent = Math.round((base * rule.percent) / 100);
  const fromShifts = shifts * rule.perShift;
  const fromMonthly = Math.round((rule.monthly * periodDays) / 30);
  return {
    resourceId: m.id, name: m.name, color: m.color, rule, visits: visits.length, revenue, materials, shifts,
    fromPercent, fromShifts, fromMonthly, total: fromPercent + fromShifts + fromMonthly,
  };
}
