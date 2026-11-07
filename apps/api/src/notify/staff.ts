import type { PrismaClient } from '@prisma/client';
import { esc, telegram } from './telegram';

/**
 * Уведомить сотрудников салона в Telegram (у кого привязан бот).
 * resourceId — мастер записи: мастер получает уведомления только о своих записях.
 * Ошибки не пробрасываются — уведомление не должно ломать основную операцию.
 */
export async function notifyStaff(
  system: PrismaClient,
  tenantId: string,
  text: string,
  opts: { resourceId?: string; ownersOnly?: boolean; buttons?: { text: string; url: string }[][] } = {},
) {
  if (!telegram.enabled) return 0;
  try {
    const members = await system.membership.findMany({
      where: {
        tenantId,
        deletedAt: null,
        user: { telegramChatId: { not: null }, deletedAt: null },
        ...(opts.ownersOnly
          ? { role: 'OWNER' }
          : { OR: [{ role: { in: ['OWNER', 'MANAGER', 'ADMIN'] } }, ...(opts.resourceId ? [{ role: 'MASTER' as const, resourceId: opts.resourceId }] : [])] }),
      },
      select: { user: { select: { telegramChatId: true } } },
    });
    const results = await Promise.all(members.map((m) => telegram.send(m.user.telegramChatId!, text, opts.buttons)));
    return results.filter((r) => r.ok).length;
  } catch {
    return 0;
  }
}

export { esc };
