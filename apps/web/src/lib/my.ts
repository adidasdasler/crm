/**
 * «Мои записи»: браузер клиента запоминает его записи во все салоны на MioFlow.
 * Хранится только ссылка на запись (адрес салона и секретный токен) — сами данные
 * каждый раз берутся с сервера. Ничего нового о клиенте не собираем.
 */
export type MyRef = { slug: string; token: string; at: string; salon?: string };
const KEY = 'mioflow_my_bookings';
const MAX = 100;

export function myBookings(): MyRef[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.slug === 'string' && typeof x.token === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberBooking(ref: MyRef) {
  try {
    const rest = myBookings().filter((x) => x.token !== ref.token);
    localStorage.setItem(KEY, JSON.stringify([ref, ...rest].slice(0, MAX)));
  } catch {
    /* приватный режим — просто не запоминаем */
  }
}

export function forgetBooking(token: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(myBookings().filter((x) => x.token !== token)));
  } catch {
    /* ничего */
  }
}

export const calendarUrl = (slug: string, token: string) => `/v1/public/${slug}/manage/${token}/calendar.ics`;
