import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  SYSTEM_DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET должен быть не короче 32 символов'),
  JWT_ACCESS_TTL_MIN: z.coerce.number().default(15),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().default(30),
  CORS_ORIGIN: z.string().default(''),
  COOKIE_DOMAIN: z.string().optional(),
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:5173'),
  /** Адрес веб-версии CRM (ссылки «оплатить» в уведомлениях) */
  APP_URL: z.string().url().default('http://localhost:8081'),
  TRIAL_DAYS: z.coerce.number().default(14),
  /** Льготный период после окончания оплаченного срока, дней */
  GRACE_DAYS: z.coerce.number().default(3),

  // ── Telegram-бот (напоминания клиентам, уведомления сотрудникам) ──
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  /** Секрет в заголовке X-Telegram-Bot-Api-Secret-Token — задаётся при setWebhook */
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  /** Можно указать свой прокси до Bot API, если api.telegram.org недоступен с сервера */
  TELEGRAM_API_BASE: z.string().url().default('https://api.telegram.org'),
  /** Публичный адрес API для регистрации вебхука, например https://salon.ru/v1 */
  API_PUBLIC_URL: z.string().url().optional(),

  // ── SMS (sms.ru) — запасной канал напоминаний ──
  SMS_RU_API_KEY: z.string().optional(),
  SMS_SENDER: z.string().optional(),

  // ── Оплата подписки ──
  /** mock — тестовые платежи без денег (только не в production) */
  PAYMENT_PROVIDER: z.enum(['yookassa', 'mock']).optional(),
  YOOKASSA_SHOP_ID: z.string().optional(),
  YOOKASSA_SECRET_KEY: z.string().optional(),
});

export const env = schema.parse(process.env);
export const isProd = env.NODE_ENV === 'production';
export const paymentProvider = env.PAYMENT_PROVIDER ?? (env.YOOKASSA_SHOP_ID ? 'yookassa' : isProd ? null : 'mock');
