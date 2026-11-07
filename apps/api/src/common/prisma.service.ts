import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { env } from '../config';

export type Tx = Prisma.TransactionClient;

/**
 * Два подключения:
 *  - app    — роль salon_app, на неё действует RLS. Использовать ТОЛЬКО через withTenant().
 *  - system — владелец схемы, RLS не действует. Только для auth, webhooks и фоновых задач,
 *             где тенант ещё неизвестен или задача работает по всем тенантам.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly app = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  readonly system = new PrismaClient({ datasourceUrl: env.SYSTEM_DATABASE_URL });

  /** Выполнить fn в транзакции, где RLS видит только данные tenantId. */
  withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.app.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return fn(tx);
      },
      { timeout: 15_000, maxWait: 5_000 },
    );
  }

  async onModuleDestroy() {
    await Promise.all([this.app.$disconnect(), this.system.$disconnect()]);
  }
}
