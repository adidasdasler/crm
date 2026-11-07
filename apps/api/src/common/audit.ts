import type { Prisma } from '@prisma/client';
import type { AuthCtx } from './auth';
import type { Tx } from './prisma.service';

export function audit(
  tx: Tx,
  auth: Pick<AuthCtx, 'tenantId' | 'userId'> | { tenantId: string; userId?: null },
  action: string,
  entityType: string,
  entityId: string | null,
  before?: unknown,
  after?: unknown,
) {
  return tx.auditLog.create({
    data: {
      tenantId: auth.tenantId,
      userId: auth.userId ?? null,
      action,
      entityType,
      entityId,
      before: (before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (after ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
