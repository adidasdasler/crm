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
  TRIAL_DAYS: z.coerce.number().default(14),
});

export const env = schema.parse(process.env);
export const isProd = env.NODE_ENV === 'production';
