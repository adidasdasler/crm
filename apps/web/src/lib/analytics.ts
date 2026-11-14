/**
 * Яндекс Метрика — только с согласия посетителя.
 * Номер счётчика приходит из /config.js (переменная YANDEX_METRIKA_ID на сервере); пусто — аналитики нет вовсе.
 * Отправляем только адрес страницы без параметров и только для «публичных» страниц: в ссылках управления
 * записью, восстановления пароля и т. п. есть секретные токены, они в Метрику не попадают.
 * Вебвизор, карта кликов и отслеживание ссылок выключены — они записывают действия и адреса сами.
 */
type Ym = ((id: number, method: string, ...args: unknown[]) => void) & { a?: unknown[]; l?: number };
const w = globalThis as unknown as { __MIOFLOW__?: { YM_ID?: string }; ym?: Ym };

export const YM_ID = Number(w.__MIOFLOW__?.YM_ID || 0) || 0;

const KEY = 'mioflow_cookie_consent';
export type Choice = 'all' | 'necessary';
const listeners = new Set<() => void>();

export function getChoice(): Choice | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'all' || v === 'necessary' ? v : null;
  } catch {
    return null;
  }
}

export function setChoice(c: Choice) {
  const before = getChoice();
  try { localStorage.setItem(KEY, c); } catch { /* приватный режим — выбор действует до закрытия вкладки */ }
  session = c;
  if (c === 'necessary' && before === 'all') {
    // Отозвали согласие: стираем cookie Метрики и перезагружаем — скрипт уже не загрузится
    for (const name of document.cookie.split(';').map((s) => s.split('=')[0].trim()).filter((n) => n.startsWith('_ym'))) {
      for (const domain of ['', `; domain=${location.hostname}`, `; domain=.${location.hostname.replace(/^www\./, '')}`]) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`;
      }
    }
    location.reload();
    return;
  }
  listeners.forEach((f) => f());
}
let session: Choice | null = null;
export const currentChoice = () => getChoice() ?? session;
export const onChoice = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

/** Страницы, адреса которых можно отправлять в Метрику */
const PUBLIC = /^\/($|cookies$|privacy$|terms$|consent$|b\/[a-z0-9-]+\/?$)/;

let loaded = false;
function load() {
  if (loaded || !YM_ID) return;
  loaded = true;
  const ym: Ym = (...args: unknown[]) => { (ym.a = ym.a || []).push(args); };
  ym.l = Date.now();
  w.ym = w.ym || ym;
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://mc.yandex.ru/metrika/tag.js';
  document.head.appendChild(s);
  w.ym!(YM_ID, 'init', { defer: true, clickmap: false, trackLinks: false, webvisor: false, accurateTrackBounce: true, trackHash: false });
}

let lastPath = '';
/** Просмотр страницы — вызывается при каждом переходе */
export function trackPage(pathname: string) {
  if (!YM_ID || currentChoice() !== 'all' || !PUBLIC.test(pathname) || pathname === lastPath) return;
  load();
  const ref = lastPath ? location.origin + lastPath : document.referrer.split('?')[0];
  lastPath = pathname;
  w.ym!(YM_ID, 'hit', location.origin + pathname, { title: document.title, referer: ref });
}
