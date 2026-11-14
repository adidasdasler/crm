import type { PrismaClient } from '@prisma/client';
import { env } from '../config';

export type PushMessage = { to: string; title: string; body: string; data?: Record<string, string>; sound?: 'default' };
type Ticket = { status: 'ok' | 'error'; details?: { error?: string } };

/** Push через Expo Push API. Транспорт подменяется в тестах. */
export const push = {
  get enabled() {
    return env.PUSH_ENABLED;
  },
  transport: async (messages: PushMessage[]): Promise<Ticket[]> => {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: Ticket[] };
    return json.data ?? messages.map(() => ({ status: 'error' as const }));
  },

  /** Отправить на все устройства пользователей; токены удалённых приложений чистим. */
  async toUsers(db: PrismaClient, userIds: string[], msg: Omit<PushMessage, 'to'>) {
    if (!this.enabled || !userIds.length) return 0;
    const tokens = await db.pushToken.findMany({ where: { userId: { in: userIds } } });
    if (!tokens.length) return 0;
    try {
      const tickets = await this.transport(tokens.map((t) => ({ ...msg, to: t.token, sound: 'default' })));
      const dead = tokens.filter((_, i) => tickets[i]?.details?.error === 'DeviceNotRegistered').map((t) => t.id);
      if (dead.length) await db.pushToken.deleteMany({ where: { id: { in: dead } } });
      return tickets.filter((t) => t.status === 'ok').length;
    } catch {
      return 0;
    }
  },
};
