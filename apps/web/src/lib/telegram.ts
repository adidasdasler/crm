/**
 * Мини-приложение Telegram без внешнего скрипта: данные запуска Telegram передаёт во фрагменте адреса
 * (#tgWebAppData=…), события отправляются через мост клиента. Подпись данных проверяет сервер.
 */
type Bridge = { postEvent?: (type: string, data: string) => void };

let cached: string | null | undefined;

/** Подписанные данные пользователя (initData) или null, если страница открыта не в Telegram */
export function tgInitData(): string | null {
  if (cached !== undefined) return cached;
  try {
    const fromHash = new URLSearchParams(location.hash.slice(1)).get('tgWebAppData');
    if (fromHash) sessionStorage.setItem('mioflow_tg', fromHash);
    cached = fromHash || sessionStorage.getItem('mioflow_tg');
  } catch {
    cached = null;
  }
  return cached ?? null;
}

/** Имя пользователя Telegram — подставим в форму */
export function tgFirstName(): string | null {
  const d = tgInitData();
  if (!d) return null;
  try {
    return (JSON.parse(new URLSearchParams(d).get('user') ?? 'null') as { first_name?: string } | null)?.first_name ?? null;
  } catch {
    return null;
  }
}

function post(type: string, data: object = {}) {
  const payload = JSON.stringify(data);
  const proxy = (window as unknown as { TelegramWebviewProxy?: Bridge }).TelegramWebviewProxy;
  if (proxy?.postEvent) proxy.postEvent(type, payload);
  else if (window.parent !== window) window.parent.postMessage(JSON.stringify({ eventType: type, eventData: data }), 'https://web.telegram.org');
}

export const tg = {
  /** Сообщить Telegram, что страница готова, и развернуть на весь экран */
  ready() {
    if (!tgInitData()) return;
    post('web_app_ready');
    post('web_app_expand');
  },
  close() {
    post('web_app_close');
  },
};
