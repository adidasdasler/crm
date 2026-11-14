/**
 * Мини-приложение MAX. Данные запуска MAX передаёт во фрагменте адреса (#WebAppData=…&WebAppStartParam=…),
 * а также в объекте window.WebApp после загрузки скрипта MAX Bridge. Подпись initData проверяет сервер.
 */
type MaxWebApp = { initData?: string; initDataUnsafe?: { start_param?: string; user?: { first_name?: string } }; ready?: () => void; close?: () => void };
const KEY = 'mioflow_max';
const START = 'mioflow_max_start';
const BRIDGE = 'https://st.max.ru/js/max-web-app.js';

const webApp = () => (window as unknown as { WebApp?: MaxWebApp }).WebApp;

let cached: string | null | undefined;
/** Подписанные данные пользователя MAX или null, если страница открыта не в мини-приложении MAX */
export function maxInitData(): string | null {
  if (cached) return cached;
  try {
    const h = new URLSearchParams(location.hash.slice(1));
    const fromHash = h.get('WebAppData');
    if (fromHash) sessionStorage.setItem(KEY, fromHash);
    const sp = h.get('WebAppStartParam');
    if (sp) sessionStorage.setItem(START, sp);
    cached = fromHash || sessionStorage.getItem(KEY) || webApp()?.initData || null;
  } catch {
    cached = webApp()?.initData || null;
  }
  return cached;
}

/** Параметр запуска (?startapp=<адрес салона>) */
export function maxStartParam(): string | null {
  try {
    return new URLSearchParams(location.hash.slice(1)).get('WebAppStartParam') || sessionStorage.getItem(START) || webApp()?.initDataUnsafe?.start_param || null;
  } catch {
    return webApp()?.initDataUnsafe?.start_param ?? null;
  }
}

export function maxFirstName(): string | null {
  const d = maxInitData();
  if (!d) return null;
  try {
    return (JSON.parse(new URLSearchParams(d).get('user') ?? 'null') as { first_name?: string } | null)?.first_name ?? null;
  } catch {
    return null;
  }
}

let loading: Promise<void> | null = null;
/** Скрипт MAX Bridge — только внутри MAX */
function bridge(): Promise<void> {
  if (webApp()) return Promise.resolve();
  loading ??= new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = BRIDGE;
    s.async = true;
    s.onload = s.onerror = () => resolve();
    document.head.appendChild(s);
  });
  return loading;
}

export const maxApp = {
  inside: () => !!maxInitData(),
  /** Сообщить MAX, что страница готова */
  ready() {
    if (!maxInitData()) return;
    void bridge().then(() => webApp()?.ready?.());
  },
  close() {
    void bridge().then(() => webApp()?.close?.());
  },
};
