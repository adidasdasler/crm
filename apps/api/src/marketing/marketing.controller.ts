import { Controller, Get } from '@nestjs/common';
import { DateTime } from 'luxon';
import { Auth, AuthCtx, Can } from '../common/auth';
import { PrismaService } from '../common/prisma.service';
import { readSettings } from '../common/tenant-settings';
import { DEFAULT_BIRTHDAY, DEFAULT_WINBACK } from './winback';

/** Сколько клиентов получат сообщения — для экрана настроек «Возврат клиентов» */
@Controller('marketing')
export class MarketingController {
  constructor(private readonly prisma: PrismaService) {}

  @Can('settings.manage')
  @Get('audience')
  audience(@Auth() a: AuthCtx) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { timezone: true, settings: true } });
      const s = readSettings(t.settings);
      const reachable = { OR: [{ telegramChatId: { not: null } }, { maxUserId: { not: null } }, { vkUserId: { not: null } }, { email: { not: null } }] };
      const base = { deletedAt: null, marketingConsent: true };
      const before = DateTime.now().setZone(t.timezone).minus({ days: s.winbackDays }).toJSDate();
      const [total, consent, reach, lapsed] = await Promise.all([
        tx.customer.count({ where: { deletedAt: null } }),
        tx.customer.count({ where: base }),
        tx.customer.count({ where: { ...base, ...reachable } }),
        tx.customer.count({ where: { ...base, ...reachable, lastVisitAt: { lt: before }, bookings: { none: { startsAt: { gt: new Date() }, status: { in: ['SCHEDULED', 'CONFIRMED'] } } } } }),
      ]);
      return { total, consent, reachable: reach, lapsed, defaults: { winback: DEFAULT_WINBACK, birthday: DEFAULT_BIRTHDAY } };
    });
  }
}
