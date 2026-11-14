/**
 * Запись ошибок в таблицу ErrorLog — их видно в админ-панели («Ошибки»).
 * Ошибка самой записи не должна ронять запрос, поэтому всё в try/catch.
 */
import { PrismaClient } from '@prisma/client';
import { env } from '../config';

let db: PrismaClient | null = null;
const client = () => (db ??= new PrismaClient({ datasourceUrl: env.SYSTEM_DATABASE_URL }));

export async function reportError(e: { source: 'api' | 'worker'; path?: string; err: unknown; requestId?: string }) {
  if (env.NODE_ENV === 'test') return;
  const err = e.err as { message?: string; stack?: string } | undefined;
  try {
    await client().errorLog.create({
      data: {
        source: e.source, path: e.path?.slice(0, 300) ?? null, requestId: e.requestId?.slice(0, 64) ?? null,
        message: String(err?.message ?? e.err).slice(0, 2000), stack: err?.stack?.slice(0, 4000) ?? null,
      },
    });
  } catch {
    /* база недоступна — ошибка всё равно есть в логах контейнера */
  }
}
