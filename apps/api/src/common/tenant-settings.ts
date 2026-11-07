import { z } from 'zod';
import { INDUSTRY_CODES } from './industries';
import { permissionsSchema } from './permissions';

const httpsUrl = z
  .string()
  .trim()
  .max(300)
  .regex(/^https:\/\/[^\s<>"']+$/, 'Ссылка должна начинаться с https://')
  .optional()
  .or(z.literal('').transform(() => undefined));

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
  /** Сфера бизнеса (src/common/industries.ts) */
  industry: z.enum(INDUSTRY_CODES).default('beauty'),
  /** Мини-сайт: описание салона и ссылки на соцсети/мессенджеры */
  about: z.string().trim().max(1500).optional(),
  links: z
    .object({
      site: httpsUrl, vk: httpsUrl, telegram: httpsUrl, max: httpsUrl, instagram: httpsUrl, whatsapp: httpsUrl,
      yandexMaps: httpsUrl, twoGis: httpsUrl,
    })
    .partial()
    .optional(),
  /** Права ролей, настраивает только владелец (PUT /tenant/permissions) */
  permissions: permissionsSchema.optional(),
  inn: z.string().trim().regex(/^(\d{10}|\d{12})$/, 'ИНН — 10 или 12 цифр').optional().or(z.literal('').transform(() => undefined)),
});
export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

export const readSettings = (raw: unknown): TenantSettings =>
  tenantSettingsSchema.parse(raw && typeof raw === 'object' ? raw : {});

/**
 * Схема частичного обновления: те же поля, но без значений по умолчанию —
 * иначе PATCH { about } сбросил бы остальные настройки к дефолтам.
 */
export const tenantSettingsPatchSchema = z.object(
  Object.fromEntries(
    Object.entries(tenantSettingsSchema.shape).map(([k, v]) => [k, (v instanceof z.ZodDefault ? (v.unwrap() as z.ZodType) : (v as z.ZodType)).optional()]),
  ) as { [K in keyof typeof tenantSettingsSchema.shape]: z.ZodOptional<z.ZodType<z.infer<typeof tenantSettingsSchema>[K]>> },
);
