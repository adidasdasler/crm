import type { Prisma, PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';
import { workIntervals, WeekSchedule } from '../bookings/slots';
import { readSettings } from '../common/tenant-settings';

/**
 * Советы владельцу на основе данных салона. Только правила, без ИИ: каждую цифру можно проверить,
 * а совет объясняет, откуда он взялся. Все запросы явно фильтруются по tenantId — функция работает
 * и под RLS (API), и системным подключением (воркер еженедельной сводки).
 */
type Db = PrismaClient | Prisma.TransactionClient;

export type Insight = {
  code: string;
  level: 'warn' | 'tip' | 'good';
  title: string;
  text: string;
  /** Куда ведёт кнопка в приложении */
  action?: { label: string; route: string };
  /** Для «давно не приходили» — кого именно позвать */
  customers?: { id: string; name: string; lastVisitAt: string }[];
};

const ACTIVE = ['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'COMPLETED'] as const;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const BANDS = [
  { key: 'morning', name: 'Утренние', from: 0, to: 12 },
  { key: 'day', name: 'Дневные', from: 12, to: 17 },
  { key: 'evening', name: 'Вечерние', from: 17, to: 24 },
] as const;
const MIN = 60_000;

/** Пересечение интервала с часами [from, to) этого же дня */
function overlapBand(start: number, end: number, tz: string, from: number, to: number) {
  const d = DateTime.fromMillis(start).setZone(tz).startOf('day');
  const bs = +d.set({ hour: from }), be = to === 24 ? +d.plus({ days: 1 }) : +d.set({ hour: to });
  return Math.max(0, Math.min(end, be) - Math.max(start, bs));
}

export async function computeInsights(db: Db, tenantId: string, now = new Date()): Promise<Insight[]> {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true, settings: true } });
  const tz = tenant.timezone;
  const settings = readSettings(tenant.settings);
  const today = DateTime.fromJSDate(now).setZone(tz).startOf('day');
  const out: Insight[] = [];

  const resources = await db.resource.findMany({ where: { tenantId, deletedAt: null, isActive: true }, select: { id: true, name: true, schedule: true } });
  if (!resources.length) return out;

  // ─── 1. Заполненность ближайшей недели по времени суток ───
  const weekEnd = today.plus({ days: 7 });
  const upcoming = await db.booking.findMany({
    where: { tenantId, status: { in: [...ACTIVE] }, startsAt: { gte: now, lt: weekEnd.toJSDate() } },
    select: { resourceId: true, startsAt: true, endsAt: true, customer: { select: { telegramChatId: true, maxUserId: true, vkUserId: true, email: true } } },
  });
  const cap: Record<string, number> = {}, used: Record<string, number> = {};
  const byDay: Record<string, Record<number, { cap: number; used: number }>> = {};
  for (let i = 0; i < 7; i++) {
    const day = today.plus({ days: i });
    for (const r of resources) {
      for (const w of workIntervals(r.schedule as WeekSchedule, day.toISODate()!, tz)) {
        const s = Math.max(w.start, +now);
        if (s >= w.end) continue;
        for (const b of BANDS) {
          const c = overlapBand(s, w.end, tz, b.from, b.to);
          cap[b.key] = (cap[b.key] ?? 0) + c;
          const wd = day.weekday - 1;
          ((byDay[b.key] ??= {})[wd] ??= { cap: 0, used: 0 }).cap += c;
        }
      }
    }
  }
  for (const bk of upcoming) {
    for (const b of BANDS) {
      const u = overlapBand(+bk.startsAt, +bk.endsAt, tz, b.from, b.to);
      used[b.key] = (used[b.key] ?? 0) + u;
      const wd = DateTime.fromJSDate(bk.startsAt).setZone(tz).weekday - 1;
      if (byDay[b.key]?.[wd]) byDay[b.key][wd].used += u;
    }
  }
  const fills = BANDS.filter((b) => (cap[b.key] ?? 0) >= 300 * MIN).map((b) => ({ ...b, fill: (used[b.key] ?? 0) / cap[b.key] }));
  const weakest = fills.sort((a, b) => a.fill - b.fill)[0];
  if (weakest && weakest.fill < 0.45 && fills.length > 1) {
    const days = Object.entries(byDay[weakest.key] ?? {})
      .filter(([, v]) => v.cap >= 60 * MIN).map(([d, v]) => ({ d: Number(d), fill: v.used / v.cap })).sort((a, b) => a.fill - b.fill).slice(0, 2).map((x) => WD[x.d]);
    out.push({
      code: 'weak_band', level: 'warn',
      title: `${weakest.name} окна на неделе заполнены на ${pct(weakest.fill)}`,
      text: `${days.length ? `Свободнее всего — ${days.join(' и ')}. ` : ''}Предложите скидку 10–15% на это время, напишите постоянным клиентам или закрепите пост со свободными окнами в соцсетях и на картах.`,
      action: { label: 'Ссылки для записи', route: '/maps' },
    });
  }

  // ─── 2. Напоминания не дойдут: у клиента нет ни мессенджера, ни email ───
  if (upcoming.length >= 5) {
    const noChannel = upcoming.filter((b) => !b.customer.telegramChatId && !b.customer.maxUserId && !b.customer.vkUserId && !b.customer.email).length;
    if (noChannel / upcoming.length >= 0.4) {
      out.push({
        code: 'no_channel', level: 'warn',
        title: `Напоминания не дойдут до ${pct(noChannel / upcoming.length)} клиентов недели`,
        text: 'У них не подключён мессенджер и нет email. При записи по телефону отправьте клиенту ссылку на запись — там кнопки Telegram, MAX и ВКонтакте. Без напоминаний неявок обычно больше.',
      });
    }
  }

  // ─── 3. Загрузка мастеров за 14 дней и оценки за 60 дней ───
  const from14 = today.minus({ days: 14 });
  const [past, reviews] = await Promise.all([
    db.booking.findMany({
      where: { tenantId, startsAt: { gte: from14.toJSDate(), lt: today.toJSDate() } },
      select: { resourceId: true, startsAt: true, endsAt: true, status: true, price: true, source: true },
    }),
    db.review.findMany({ where: { tenantId, createdAt: { gte: today.minus({ days: 60 }).toJSDate() } }, select: { resourceId: true, rating: true } }),
  ]);
  const loads = resources.map((r) => {
    let capacity = 0;
    for (let i = 1; i <= 14; i++) for (const w of workIntervals(r.schedule as WeekSchedule, today.minus({ days: i }).toISODate()!, tz)) capacity += w.end - w.start;
    const busy = past.filter((b) => b.resourceId === r.id && ACTIVE.includes(b.status as never)).reduce((s, b) => s + (+b.endsAt - +b.startsAt), 0);
    const rv = reviews.filter((x) => x.resourceId === r.id);
    return { ...r, load: capacity ? busy / capacity : 0, capacity, rating: rv.length ? rv.reduce((s, x) => s + x.rating, 0) / rv.length : null, reviews: rv.length };
  }).filter((r) => r.capacity > 0);
  const top = [...loads].sort((a, b) => b.load - a.load)[0];
  const low = [...loads].sort((a, b) => a.load - b.load)[0];
  if (loads.length >= 2 && top.load >= 0.85 && low.load <= 0.5) {
    out.push({
      code: 'imbalance', level: 'tip',
      title: `${top.name} загружен(а) на ${pct(top.load)}, ${low.name} — на ${pct(low.load)}`,
      text: `К ${top.name} записываются охотнее. Можно поднять цену у ${top.name} на 10% и предлагать новым клиентам ${low.name}, или включить «любой мастер» по умолчанию.`,
      action: { label: 'Мастера', route: '/masters' },
    });
  }
  for (const r of loads) {
    if (r.rating !== null && r.reviews >= 5 && r.rating >= 4.7 && r.load >= 0.8) {
      out.push({
        code: `raise_price:${r.id}`, level: 'good',
        title: `${r.name}: оценка ${r.rating.toFixed(1)} по ${r.reviews} отзывам и загрузка ${pct(r.load)}`,
        text: `Клиенты довольны, а свободного времени почти нет — это хороший момент поднять цену на услуги ${r.name} на 10–15%.`,
        action: { label: 'Услуги и цены', route: '/services' },
      });
    } else if (r.rating !== null && r.reviews >= 5 && r.rating < 4.2) {
      out.push({
        code: `low_rating:${r.id}`, level: 'warn',
        title: `${r.name}: средняя оценка ${r.rating.toFixed(1)} по ${r.reviews} отзывам`,
        text: 'Посмотрите комментарии клиентов и обсудите их с мастером. Низкие оценки в приложении — шанс исправиться до отзывов на картах.',
      });
    }
  }

  // ─── 4. Неявки за 28 дней ───
  const from28 = today.minus({ days: 28 }).toJSDate();
  const last28 = await db.booking.findMany({ where: { tenantId, startsAt: { gte: from28, lt: today.toJSDate() }, status: { not: 'CANCELLED' } }, select: { status: true, source: true } });
  if (last28.length >= 10) {
    const ns = last28.filter((b) => b.status === 'NO_SHOW').length / last28.length;
    if (ns >= 0.08) {
      out.push({
        code: 'no_show', level: 'warn',
        title: `Неявки: ${pct(ns)} записей за 4 недели`,
        text: settings.remindersEnabled
          ? 'Попросите клиентов подтверждать визит кнопкой в напоминании и звоните тем, кто не подтвердил за сутки. Для дорогих услуг можно брать предоплату.'
          : 'Напоминания клиентам выключены — включите их в настройках салона. Это самый простой способ сократить неявки.',
        action: settings.remindersEnabled ? undefined : { label: 'Настройки', route: '/salon' },
      });
    }
    // ─── 5. Мало онлайн-записей ───
    const online = last28.filter((b) => b.source === 'WIDGET' || b.source === 'TELEGRAM').length / last28.length;
    if (online < 0.3) {
      out.push({
        code: 'online_share', level: 'tip',
        title: `Онлайн записываются только ${pct(online)} клиентов`,
        text: 'Добавьте кнопку «Записаться» в Яндекс Карты и 2ГИС, ссылку — в профиль ВКонтакте и Telegram, QR — на стойку. Каждая онлайн-запись экономит администратору звонок.',
        action: { label: 'Карты и ссылки', route: '/maps' },
      });
    }
  }

  // ─── 6. Клиенты, которые давно не приходили ───
  const yearAgo = today.minus({ days: 365 }).toJSDate();
  const visits = await db.booking.findMany({
    where: { tenantId, status: 'COMPLETED', startsAt: { gte: yearAgo }, customer: { deletedAt: null } },
    select: { customerId: true, startsAt: true, customer: { select: { name: true } } },
    orderBy: { startsAt: 'asc' },
  });
  const byCustomer = new Map<string, { name: string; dates: number[] }>();
  for (const v of visits) {
    const c = byCustomer.get(v.customerId) ?? { name: v.customer.name, dates: [] };
    c.dates.push(+v.startsAt);
    byCustomer.set(v.customerId, c);
  }
  const future = new Set((await db.booking.findMany({
    where: { tenantId, startsAt: { gte: now }, status: { in: ['SCHEDULED', 'CONFIRMED'] } }, select: { customerId: true },
  })).map((b) => b.customerId));
  const lapsed = [...byCustomer.entries()]
    .filter(([id, c]) => c.dates.length >= 2 && !future.has(id))
    .map(([id, c]) => {
      const interval = (c.dates.at(-1)! - c.dates[0]) / (c.dates.length - 1);
      const since = +now - c.dates.at(-1)!;
      return { id, name: c.name, last: c.dates.at(-1)!, overdue: since / Math.max(interval, 14 * 86400_000), since };
    })
    .filter((c) => c.overdue >= 2 && c.since >= 30 * 86400_000)
    .sort((a, b) => b.overdue - a.overdue);
  if (lapsed.length) {
    out.push({
      code: 'lapsed', level: 'tip',
      title: `${lapsed.length} постоянных клиентов не приходили дольше обычного`,
      text: 'Напишите им лично: «Давно не виделись! Есть окна на этой неделе» и ссылку на запись. Вернуть знакомого клиента дешевле, чем найти нового.',
      customers: lapsed.slice(0, 10).map((c) => ({ id: c.id, name: c.name, lastVisitAt: new Date(c.last).toISOString() })),
      action: { label: 'Клиенты', route: '/customers' },
    });
  }

  // ─── 7. Склад ───
  const soon = today.plus({ days: 30 }).toJSDate();
  const [lowStock, expiring] = await Promise.all([
    db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "Material" WHERE "tenantId" = ${tenantId}::uuid AND "deletedAt" IS NULL AND "isActive" AND "minStock" > 0 AND "stock" <= "minStock"`,
    db.materialBatch.count({ where: { tenantId, remaining: { gt: 0 }, expiresAt: { not: null, lte: soon }, material: { deletedAt: null, isActive: true } } }),
  ]);
  const lowN = Number(lowStock[0]?.n ?? 0);
  if (lowN || expiring) {
    out.push({
      code: 'stock', level: 'warn',
      title: [lowN && `мало материалов: ${lowN}`, expiring && `партий с истекающим сроком: ${expiring}`].filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase()),
      text: 'Закажите материалы заранее, а партии с истекающим сроком используйте в первую очередь — приложение списывает их первыми.',
      action: { label: 'Склад', route: '/stock' },
    });
  }

  // ─── 8. Хорошая новость: неделя лучше предыдущей ───
  const w1 = past.filter((b) => +b.startsAt >= +today.minus({ days: 7 }) && ACTIVE.includes(b.status as never)).reduce((s, b) => s + b.price, 0);
  const w0 = past.filter((b) => +b.startsAt < +today.minus({ days: 7 }) && ACTIVE.includes(b.status as never)).reduce((s, b) => s + b.price, 0);
  if (w0 > 0 && w1 / w0 >= 1.15) {
    out.push({ code: 'growth', level: 'good', title: `Неделя на ${pct(w1 / w0 - 1)} лучше предыдущей`, text: 'Записей на сумму больше — так держать!' });
  }

  const order = { warn: 0, tip: 1, good: 2 } as const;
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
