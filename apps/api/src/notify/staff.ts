import type { PrismaClient } from '@prisma/client';
import { push } from './push';
import { esc, telegram } from './telegram';

/**
 * Уведомить сотрудников салона: Telegram (если привязан) и push в приложение (если включено).
 * resourceId — мастер записи: мастер получает уведомления только о своих записях.
 * Ошибки не пробрасываются — уведомление не должно ломать основную операцию.
 */
export async function notifyStaff(
  system: PrismaClient,
  tenantId: string,
  text: string,
  opts: { resourceId?: string; ownersOnly?: boolean; buttons?: { text: string; url: string }[][]; push?: { title: string; body: string; data?: Record<string, string> } } = {},
) {
  try {
    const members = await system.membership.findMany({
      where: {
        tenantId,
        deletedAt: null,
        user: { deletedAt: null },
        ...(opts.ownersOnly
          ? { role: 'OWNER' }
          : { OR: [{ role: { in: ['OWNER', 'MANAGER', 'ADMIN'] } }, ...(opts.resourceId ? [{ role: 'MASTER' as const, resourceId: opts.resourceId }] : [])] }),
      },
      select: { user: { select: { id: true, telegramChatId: true } } },
    });
    const tg = telegram.enabled
      ? await Promise.all(members.filter((m) => m.user.telegramChatId).map((m) => telegram.send(m.user.telegramChatId!, text, opts.buttons)))
      : [];
    const pushed = opts.push ? await push.toUsers(system, members.map((m) => m.user.id), opts.push) : 0;
    return tg.filter((r) => r.ok).length + pushed;
  } catch {
    return 0;
  }
}

export { esc };
