import { Injectable } from '@nestjs/common';
import type { BillingPeriod, PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';
import { AppError, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { env } from '../config';
import { notifyStaff } from '../notify/staff';
import { getProvider } from './providers';

const ACCESS_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE'];

/** Кеш статуса подписки для guard (сбрасывается при оплате). */
const statusCache = new Map<string, { status: string; at: number }>();
export const forgetSubscriptionStatus = (tenantId: string) => statusCache.delete(tenantId);

export async function subscriptionStatus(system: PrismaClient, tenantId: string): Promise<string> {
  const c = statusCache.get(tenantId);
  if (c && Date.now() - c.at < 30_000) return c.status;
  const s = await system.subscription.findUnique({ where: { tenantId }, select: { status: true } });
  const status = s?.status ?? 'EXPIRED';
  statusCache.set(tenantId, { status, at: Date.now() });
  return status;
}

export const fmtDate = (d: Date, tz = 'Europe/Moscow') => DateTime.fromJSDate(d, { zone: tz }).setLocale('ru').toFormat('d MMMM yyyy');

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Создать платёж и получить ссылку на оплату. Повторный запрос в течение часа вернёт ту же ссылку. */
  async createPaymentLink(tenantId: string, planCode: string, period: BillingPeriod) {
    const provider = getProvider();
    if (!provider) throw new AppError('PAYMENTS_DISABLED', 'Онлайн-оплата пока не подключена. Напишите в поддержку', 503);
    const db = this.prisma.system;
    const plan = await db.plan.findFirst({ where: { code: planCode, isActive: true } });
    if (!plan) throw notFound('Тариф');
    const sub = await db.subscription.findUnique({ where: { tenantId } });
    if (!sub) throw notFound('Подписка');

    const masters = await db.resource.count({ where: { tenantId, deletedAt: null, isActive: true } });
    const limit = Number((plan.limits as { masters?: number }).masters ?? Infinity);
    if (masters > limit) {
      throw new AppError('PLAN_LIMIT', `На тарифе «${plan.name}» до ${limit} мастеров, а у вас активных ${masters}. Выберите тариф выше или отключите лишних мастеров`, 422);
    }

    const recent = await db.payment.findFirst({
      where: { tenantId, status: 'PENDING', planId: plan.id, billingPeriod: period, createdAt: { gt: new Date(Date.now() - 3600_000) }, confirmationUrl: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) return recent;

    const amount = period === 'YEARLY' ? plan.priceYearly : plan.priceMonthly;
    const payment = await db.payment.create({
      data: { tenantId, subscriptionId: sub.id, planId: plan.id, billingPeriod: period, amount, status: 'PENDING', provider: provider.name },
    });
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    try {
      const r = await provider.create({
        paymentId: payment.id,
        amount,
        description: `Подписка MioFlow, тариф «${plan.name}», ${period === 'YEARLY' ? '12 мес.' : '1 мес.'} — ${tenant.name}`,
        returnUrl: `${env.APP_URL}/billing?payment=${payment.id}`,
        metadata: { paymentId: payment.id, tenantId },
      });
      return db.payment.update({ where: { id: payment.id }, data: { externalId: r.externalId, confirmationUrl: r.confirmationUrl } });
    } catch (e) {
      await db.payment.update({ where: { id: payment.id }, data: { status: 'CANCELED', metadata: { error: (e as Error).message } } });
      throw new AppError('PAYMENT_PROVIDER_ERROR', 'Платёжная система не ответила, попробуйте ещё раз через минуту', 502);
    }
  }

  /**
   * Платёж прошёл → продлить подписку. Идемпотентно: повторный вебхук ничего не изменит.
   * Новый срок отсчитывается от конца текущего оплаченного/пробного периода, если он ещё не истёк.
   */
  async markSucceeded(paymentId: string, paidAt = new Date()) {
    const db = this.prisma.system;
    const result = await db.$transaction(async (tx) => {
      const r = await tx.payment.updateMany({ where: { id: paymentId, status: 'PENDING' }, data: { status: 'SUCCEEDED', paidAt } });
      if (!r.count) return null;
      const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      const sub = await tx.subscription.findUniqueOrThrow({ where: { id: p.subscriptionId } });
      const now = new Date();
      const candidates = [now, sub.status === 'TRIAL' ? sub.trialEndsAt : null, ['ACTIVE', 'PAST_DUE'].includes(sub.status) ? sub.currentPeriodEnd : null]
        .filter((d): d is Date => !!d && d > now);
      const base = candidates.length ? new Date(Math.max(...candidates.map(Number))) : now;
      const end = DateTime.fromJSDate(base).plus(p.billingPeriod === 'YEARLY' ? { years: 1 } : { months: 1 }).toJSDate();
      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: { status: 'ACTIVE', planId: p.planId, billingPeriod: p.billingPeriod, currentPeriodEnd: end, lastNoticeAt: null },
        include: { plan: true },
      });
      await tx.auditLog.create({ data: { tenantId: p.tenantId, action: 'billing.paid', entityType: 'Payment', entityId: p.id, after: { amount: p.amount, until: end } } });
      return { p, updated };
    });
    if (!result) return null;
    forgetSubscriptionStatus(result.p.tenantId);
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: result.p.tenantId } });
    void notifyStaff(db, tenant.id, `💳 Оплата получена: ${(result.p.amount / 100).toLocaleString('ru-RU')} ₽. Тариф «${result.updated.plan.name}» оплачен до ${fmtDate(result.updated.currentPeriodEnd!, tenant.timezone)}. Спасибо!`, { ownersOnly: true });
    return result.updated;
  }

  async markCanceled(paymentId: string) {
    await this.prisma.system.payment.updateMany({ where: { id: paymentId, status: 'PENDING' }, data: { status: 'CANCELED' } });
  }
}

/**
 * Ежедневная проверка подписок (воркер):
 *  - срок истёк → PAST_DUE (льготные GRACE_DAYS дней: всё работает, показываем предупреждение);
 *  - льготный период прошёл → EXPIRED (онлайн-запись выключается, CRM только для чтения);
 *  - за 3 дня до окончания и в льготный период — напоминание владельцу в Telegram раз в сутки.
 */
export async function billingTick(db: PrismaClient, now = new Date()) {
  const grace = env.GRACE_DAYS * 86400_000;
  const stats = { pastDue: 0, expired: 0, notified: 0 };

  const ended = await db.subscription.findMany({
    where: { OR: [{ status: 'TRIAL', trialEndsAt: { lte: now } }, { status: 'ACTIVE', currentPeriodEnd: { lte: now } }] },
  });
  for (const s of ended) {
    await db.subscription.update({ where: { id: s.id }, data: { status: 'PAST_DUE', currentPeriodEnd: s.currentPeriodEnd ?? s.trialEndsAt, lastNoticeAt: null } });
    forgetSubscriptionStatus(s.tenantId);
    stats.pastDue++;
  }

  const expired = await db.subscription.updateMany({ where: { status: 'PAST_DUE', currentPeriodEnd: { lte: new Date(+now - grace) } }, data: { status: 'EXPIRED' } });
  stats.expired = expired.count;
  if (expired.count) statusCache.clear();

  const soon = new Date(+now + 3 * 86400_000);
  const toNotify = await db.subscription.findMany({
    where: {
      AND: [
        { OR: [{ lastNoticeAt: null }, { lastNoticeAt: { lt: new Date(+now - 20 * 3600_000) } }] },
        {
          OR: [
            { status: 'TRIAL', trialEndsAt: { lte: soon } },
            { status: 'ACTIVE', currentPeriodEnd: { lte: soon } },
            { status: 'PAST_DUE' },
          ],
        },
      ],
    },
    include: { plan: true },
  });
  for (const s of toNotify) {
    const t = await db.tenant.findUniqueOrThrow({ where: { id: s.tenantId } });
    const end = (s.status === 'TRIAL' ? s.trialEndsAt : s.currentPeriodEnd)!;
    const text =
      s.status === 'PAST_DUE'
        ? `⚠️ Подписка «${t.name}» не оплачена. Онлайн-запись и календарь будут отключены ${fmtDate(new Date(+end + grace), t.timezone)}. Оплатить: ${env.APP_URL}/billing`
        : `🔔 ${s.status === 'TRIAL' ? 'Пробный период' : 'Оплаченный период'} «${t.name}» заканчивается ${fmtDate(end, t.timezone)}. Продлить: ${env.APP_URL}/billing`;
    await notifyStaff(db, t.id, text, { ownersOnly: true });
    await db.subscription.update({ where: { id: s.id }, data: { lastNoticeAt: now } });
    stats.notified++;
  }
  return stats;
}

export { ACCESS_STATUSES };
