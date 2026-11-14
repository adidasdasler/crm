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
  /** Ступени депозита: «пополни на amount — получи bonus сверху», копейки */
  depositTiers: z.array(z.object({ amount: z.number().int().min(100).max(100_000_000), bonus: z.number().int().min(0).max(100_000_000) })).max(6).default([]),
  /** Списывать стоимость визита с депозита клиента при завершении визита */
  depositAutoCharge: z.boolean().default(true),
  /** Просить клиента оценить визит через 2 часа после завершения */
  feedbackEnabled: z.boolean().default(true),
  /** Еженедельная сводка с советами владельцу (понедельник утром) */
  insightsDigest: z.boolean().default(true),
  /**
   * Возврат клиентов (только клиентам с согласием на рассылку — 38-ФЗ):
   * «давно не были» через N дней после последнего визита и поздравление с днём рождения.
   */
  winbackEnabled: z.boolean().default(false),
  winbackDays: z.number().int().min(14).max(365).default(45),
  winbackText: z.string().trim().max(500).optional(),
  birthdayEnabled: z.boolean().default(false),
  birthdayText: z.string().trim().max(500).optional(),
  /** Юридическое лицо/ИП салона — оператор ПДн своих клиентов (страница согласия) */
  legalName: z.string().trim().max(200).optional(),
  /** Частный мастер: в приложении скрыты команда и роли, в онлайн-записи нет выбора мастера */
  solo: z.boolean().default(false),
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
