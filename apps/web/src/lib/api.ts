const BASE = import.meta.env.VITE_API_URL ?? '/v1';

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'salon', ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    throw new ApiError(body?.error?.code ?? 'NETWORK', body?.error?.message ?? 'Нет связи с сервером', res.status);
  }
  return body.data as T;
}

export const rub = (kop: number) =>
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(kop / 100);

export const minutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} ч${m % 60 ? ` ${m % 60} мин` : ''}` : `${m} мин`);

/** Время/дата в часовом поясе салона */
export const fmtTime = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso));
export const fmtDate = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(new Date(iso));

/** YYYY-MM-DD «сегодня + n» в часовом поясе салона */
export function dateInTz(tz: string, plusDays = 0): string {
  const d = new Date(Date.now() + plusDays * 86400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Адреса подставляет контейнер при запуске (/config.js, deploy/nginx/40-mioflow-config.sh) */
const runtime = (globalThis as { __MIOFLOW__?: { APP_URL?: string; PUBLIC_WEB_URL?: string } }).__MIOFLOW__;
export const APP_URL = runtime?.APP_URL || import.meta.env.VITE_APP_URL || 'http://localhost:8081';
