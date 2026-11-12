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
  /** Secure-cookie (только HTTPS). false — для временного запуска по IP без домена и сертификата. */
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  /** Где хранить фото дизайнов (том Docker). Потом можно переключить на S3 */
  UPLOADS_DIR: z.string().default('./uploads'),
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
  /** Публичный адрес API для регистрации вебхука, например https://mioflow.ru/v1 */
  API_PUBLIC_URL: z.string().url().optional(),

  // ── ВКонтакте: сообщество MioFlow (Callback API + сообщения сообщества) ──
  VK_GROUP_TOKEN: z.string().optional(),
  /** Короткое имя сообщества для ссылки vk.me/<имя> */
  VK_GROUP_SCREEN_NAME: z.string().optional(),
  /** Строка, которую VK просит вернуть при подтверждении адреса сервера */
  VK_CONFIRMATION_CODE: z.string().optional(),
  /** Секретный ключ Callback API (настраивается в сообществе) */
  VK_SECRET: z.string().optional(),

  // ── Мессенджер MAX: бот MioFlow (https://dev.max.ru) ──
  MAX_BOT_TOKEN: z.string().optional(),
  MAX_BOT_USERNAME: z.string().optional(),
  MAX_WEBHOOK_SECRET: z.string().optional(),
  MAX_API_BASE: z.string().url().default('https://platform-api2.max.ru'),

  // ── Почта (восстановление пароля): smtps://user:pass@smtp.yandex.ru:465 ──
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('MioFlow <no-reply@mioflow.ru>'),

  // ── Push-уведомления через Expo. Это трансграничная передача (серверы Expo/Apple/Google) —
  //    включайте после уведомления Роскомнадзора. ──
  PUSH_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),

  // ── Оплата подписки ──
  /** mock — тестовые платежи без денег (только не в production) */
  PAYMENT_PROVIDER: z.enum(['yookassa', 'mock']).optional(),
  YOOKASSA_SHOP_ID: z.string().optional(),
  YOOKASSA_SECRET_KEY: z.string().optional(),
  /** Ключ шифрования секретов салонов в базе (ключи ЮKassa для предоплаты). 32+ символа */
  SECRETS_KEY: z.string().min(32).optional(),
  /** Панель владельца (mioflow.ru/admin): пускать только с этих IP через запятую (необязательно) */
  ADMIN_ALLOWED_IPS: z.string().optional(),
  /** Версия образа — показывается в админ-панели */
  APP_VERSION: z.string().default('dev'),
});

// Пустые переменные (например, `FOO=` в .env или docker-compose) считаем незаданными — тогда работают значения по умолчанию.
export const env = schema.parse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== '')));
export const isProd = env.NODE_ENV === 'production';
export const cookieSecure = env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProd;
export const paymentProvider = env.PAYMENT_PROVIDER ?? (env.YOOKASSA_SHOP_ID ? 'yookassa' : isProd ? null : 'mock');
