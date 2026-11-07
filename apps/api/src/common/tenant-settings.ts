import { z } from 'zod';
import { permissionsSchema } from './permissions';

export const tenantSettingsSchema = z.object({
  /** Шаг сетки слотов, мин */
  slotStepMin: z.number().int().min(5).max(120).default(15),
  /** Не раньше чем за N минут до визита можно записаться онлайн */
  minLeadMin: z.number().int().min(0).max(7 * 24 * 60).default(60),
  /** На сколько дней вперёд открыта онлайн-запись */
  maxDaysAhead: z.number().int().min(1).max(365).default(60),
  /** Клиент может отменить запись не позднее чем за N часов */
  cancelBeforeHours: z.number().int().min(0).max(168).default(3),
  onlineBookingEnabled: z.boolean().default(true),
  remindersEnabled: z.boolean().default(true),
  /** Юридическое лицо/ИП салона — оператор ПДн своих клиентов (страница согласия) */
  legalName: z.string().trim().max(200).optional(),
  /** Права ролей, настраивает только владелец (PUT /tenant/permissions) */
  permissions: permissionsSchema.optional(),
  inn: z.string().trim().regex(/^(\d{10}|\d{12})$/, 'ИНН — 10 или 12 цифр').optional().or(z.literal('').transform(() => undefined)),
});
export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

export const readSettings = (raw: unknown): TenantSettings =>
  tenantSettingsSchema.parse(raw && typeof raw === 'object' ? raw : {});
