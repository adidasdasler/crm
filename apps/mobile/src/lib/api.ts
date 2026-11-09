import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Адрес API. Задаётся в .env: EXPO_PUBLIC_API_URL=https://mioflow.ru/v1
 * Для Android-эмулятора локальный сервер — http://10.0.2.2:4000/v1.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'web' ? '/v1' : 'http://localhost:4000/v1');
/** В веб-версии адреса подставляет контейнер при запуске (/config.js), в приложениях — EAS при сборке */
const runtime = (globalThis as { __MIOFLOW__?: { APP_URL?: string; PUBLIC_WEB_URL?: string } }).__MIOFLOW__;
export const PUBLIC_WEB_URL = runtime?.PUBLIC_WEB_URL || process.env.EXPO_PUBLIC_WEB_URL || 'http://localhost:5173';
/** Веб-версия CRM — на iOS оплата подписки только там (правила App Store) */
export const APP_WEB_URL = runtime?.APP_URL || process.env.EXPO_PUBLIC_APP_URL || 'http://localhost:8081';

const isWeb = Platform.OS === 'web';
const ACCESS = 'salon.access';
const REFRESH = 'salon.refresh';

/**
 * Токены:
 *  - iOS/Android — Bearer + refresh в SecureStore (Keychain / Keystore);
 *  - Web — httpOnly-cookie, JS токены не видит (защита от XSS).
 */
let accessToken: string | null = null;

export const tokens = {
  async load() {
    if (isWeb) return;
    accessToken = await SecureStore.getItemAsync(ACCESS);
  },
  async save(t: { accessToken?: string; refreshToken?: string }) {
    if (isWeb || !t.accessToken || !t.refreshToken) return;
    accessToken = t.accessToken;
    await SecureStore.setItemAsync(ACCESS, t.accessToken);
    await SecureStore.setItemAsync(REFRESH, t.refreshToken);
  },
  async clear() {
    accessToken = null;
    if (isWeb) return;
    await SecureStore.deleteItemAsync(ACCESS);
    await SecureStore.deleteItemAsync(REFRESH);
  },
  refresh: () => (isWeb ? Promise.resolve(null) : SecureStore.getItemAsync(REFRESH)),
  /** Текущий access-токен (для прямых запросов вроде скачивания файлов) */
  access: async () => accessToken,
};

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public details?: unknown) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export const setOnUnauthorized = (fn: () => void) => { onUnauthorized = fn; };

/** Один refresh на все параллельные запросы (single-flight). */
let refreshing: Promise<boolean | 'offline'> | null = null;
async function refreshTokens(): Promise<boolean | 'offline'> {
  refreshing ??= (async () => {
    try {
      const refreshToken = await tokens.refresh();
      if (!isWeb && !refreshToken) return false;
      let res: Response;
      try {
        res = await raw('/auth/refresh', { method: 'POST', body: JSON.stringify(isWeb ? {} : { refreshToken }) });
      } catch {
        return 'offline'; // нет сети — это не повод выходить из аккаунта
      }
      if (!res.ok) return false;
      const body = await res.json();
      await tokens.save(body.data);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => { refreshing = null; }, 0);
    }
  })();
  return refreshing;
}

function raw(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Requested-With': 'salon', ...(init.headers as Record<string, string>) };
  if (!isWeb) {
    headers['X-Client'] = 'mobile';
    if (accessToken && !path.startsWith('/auth/refresh')) headers.Authorization = `Bearer ${accessToken}`;
  }
  return fetch(API_URL + path, { ...init, headers, credentials: isWeb ? 'include' : 'omit' });
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const req = () => raw(path, json !== undefined ? { ...rest, body: JSON.stringify(json) } : rest);
  let res: Response;
  try {
    res = await req();
  } catch {
    throw new ApiError('NETWORK', 'Нет связи с сервером. Проверьте интернет', 0);
  }
  if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/register')) {
    const r = await refreshTokens();
    if (r === 'offline') throw new ApiError('NETWORK', 'Нет связи с сервером. Проверьте интернет', 0);
    if (r) {
      try { res = await req(); } catch { throw new ApiError('NETWORK', 'Нет связи с сервером. Проверьте интернет', 0); }
    } else {
      await tokens.clear();
      onUnauthorized();
    }
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    throw new ApiError(body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? `Ошибка ${res.status}`, res.status, body?.error?.details);
  }
  return body.data as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, json?: unknown) => api<T>(path, { method: 'POST', json: json ?? {} });
export const patch = <T>(path: string, json: unknown) => api<T>(path, { method: 'PATCH', json });
export const put = <T>(path: string, json: unknown) => api<T>(path, { method: 'PUT', json });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });
