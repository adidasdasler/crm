import { DateTime } from 'luxon';
import { rangesOn, type Schedule } from '../bookings/slots';

const DAYS = ['1', '2', '3', '4', '5', '6', '7'] as const;
const SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const SCHEMA_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export type DayHours = { day: (typeof DAYS)[number]; from: string; to: string } | null;

/**
 * Часы работы салона по дням недели: самое раннее начало и самый поздний конец среди мастеров
 * на ближайшие 2 недели — так учитываются и сменные графики (2/2), и особые дни.
 */
export function salonHours(schedules: unknown[], tz: string, from = new Date()): DayHours[] {
  const start = DateTime.fromJSDate(from).setZone(tz).startOf('day');
  return DAYS.map((day, idx) => {
    const ranges: [string, string][] = [];
    for (let i = 0; i < 14; i++) {
      const d = start.plus({ days: i });
      if (d.weekday !== idx + 1) continue;
      for (const s of schedules) if (s) ranges.push(...rangesOn(s as Schedule, d.toISODate()!, d.weekday));
    }
    if (!ranges.length) return null;
    return { day, from: ranges.map((r) => r[0]).sort()[0], to: ranges.map((r) => r[1]).sort().at(-1)! };
  });
}

/** «Пн–Пт 10:00–20:00, Сб 10:00–18:00, Вс выходной» */
export function hoursText(hours: DayHours[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < 7) {
    let j = i;
    const key = (h: DayHours) => (h ? `${h.from}–${h.to}` : 'выходной');
    while (j + 1 < 7 && key(hours[j + 1]) === key(hours[i])) j++;
    parts.push(`${SHORT[i]}${j > i ? `–${SHORT[j]}` : ''} ${key(hours[i])}`);
    i = j + 1;
  }
  return parts.join(', ');
}

export const escHtml = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** JSON внутри <script> не должен закрывать тег */
const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

export type MiniSite = {
  name: string; slug: string; phone: string | null; address: string | null; about?: string;
  url: string; ogImage: string; schemaType: string; industryLabel: string;
  hours: DayHours[];
  services: { name: string; price: number; duration: number; category?: string | null }[];
  masters: { name: string; position: string | null }[];
  links: Record<string, string | undefined>;
};

const rub = (kop: number) => `${Math.round(kop / 100).toLocaleString('ru-RU')} ₽`;

/**
 * HTML мини-сайта для поисковых роботов и превью ссылок (Яндекс, 2ГИС, Telegram, VK).
 * Людям отдаётся SPA, роботам — эта страница с теми же данными (см. deploy/nginx/salon-common.conf).
 */
export function renderMiniSite(m: MiniSite): string {
  const title = `${m.name} — онлайн-запись`;
  const desc = (m.about?.slice(0, 160) || `${m.industryLabel}${m.address ? `, ${m.address}` : ''}. Онлайн-запись 24/7: выберите услугу, мастера и время.`).replace(/\s+/g, ' ');
  const prices = m.services.map((s) => s.price).filter((p) => p > 0);
  const ld = {
    '@context': 'https://schema.org',
    '@type': m.schemaType,
    name: m.name,
    url: m.url,
    image: m.ogImage,
    ...(m.phone ? { telephone: m.phone } : {}),
    ...(m.address ? { address: { '@type': 'PostalAddress', streetAddress: m.address, addressCountry: 'RU' } } : {}),
    ...(m.about ? { description: m.about } : {}),
    ...(prices.length ? { priceRange: `${rub(Math.min(...prices))} – ${rub(Math.max(...prices))}` } : {}),
    openingHoursSpecification: m.hours.flatMap((h, i) => (h ? [{ '@type': 'OpeningHoursSpecification', dayOfWeek: SCHEMA_DAYS[i], opens: h.from, closes: h.to }] : [])),
    potentialAction: { '@type': 'ReserveAction', target: { '@type': 'EntryPoint', urlTemplate: m.url, actionPlatform: ['https://schema.org/DesktopWebPlatform', 'https://schema.org/MobileWebPlatform'] } },
    hasOfferCatalog: {
      '@type': 'OfferCatalog', name: 'Услуги',
      itemListElement: m.services.slice(0, 100).map((s) => ({ '@type': 'Offer', price: (s.price / 100).toFixed(0), priceCurrency: 'RUB', itemOffered: { '@type': 'Service', name: s.name } })),
    },
    sameAs: Object.values(m.links).filter(Boolean),
  };
  return `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(title)}</title>
<meta name="description" content="${escHtml(desc)}">
<link rel="canonical" href="${escHtml(m.url)}">
<meta property="og:type" content="website"><meta property="og:locale" content="ru_RU">
<meta property="og:title" content="${escHtml(title)}"><meta property="og:description" content="${escHtml(desc)}">
<meta property="og:url" content="${escHtml(m.url)}"><meta property="og:image" content="${escHtml(m.ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${safeJson(ld)}</script>
</head><body>
<main>
<h1>${escHtml(m.name)}</h1>
<p>${escHtml(m.industryLabel)}</p>
${m.about ? `<p>${escHtml(m.about)}</p>` : ''}
${m.address ? `<p>Адрес: ${escHtml(m.address)}</p>` : ''}
${m.phone ? `<p>Телефон: <a href="tel:${escHtml(m.phone)}">${escHtml(m.phone)}</a></p>` : ''}
<p>Часы работы: ${escHtml(hoursText(m.hours))}</p>
<p><a href="${escHtml(m.url)}">Записаться онлайн</a></p>
<h2>Услуги и цены</h2>
<ul>${m.services.map((s) => `<li>${escHtml(s.name)} — ${s.price ? `от ${rub(s.price)}` : 'цена по запросу'}, ${s.duration} мин</li>`).join('')}</ul>
${m.masters.length ? `<h2>Мастера</h2><ul>${m.masters.map((x) => `<li>${escHtml(x.name)}${x.position ? `, ${escHtml(x.position)}` : ''}</li>`).join('')}</ul>` : ''}
</main>
</body></html>`;
}
