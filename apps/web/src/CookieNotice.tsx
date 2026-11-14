import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { tgInitData } from './lib/telegram';

const KEY = 'mioflow_cookie_notice';
const read = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };

/**
 * Сообщение о cookie внизу экрана. Сайт ставит только необходимые cookie, поэтому это уведомление,
 * а не запрос согласия: кнопка одна. Если появится аналитика — здесь нужен выбор «Принять / Отклонить».
 */
export function CookieNotice() {
  const [hidden, setHidden] = useState(read);
  const { pathname } = useLocation();
  // Внутри Telegram и на самой странице о cookie сообщение лишнее
  if (hidden || pathname === '/cookies' || tgInitData()) return null;
  const ok = () => { try { localStorage.setItem(KEY, '1'); } catch { /* приватный режим — просто скроем */ } setHidden(true); };
  return (
    <div role="region" aria-label="Сообщение о cookie" className="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-4">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-lg sm:flex-row sm:items-center sm:gap-6 sm:p-5">
        <div className="flex-1 text-sm text-ink">
          <p className="font-semibold">На этом сайте используются cookie</p>
          <p className="mt-1 text-ink-muted">
            Только необходимые — для входа в аккаунт и защиты от взлома. Без рекламы и аналитики.{' '}
            <Link to="/cookies" className="text-brand-600 underline">Подробнее</Link>
          </p>
        </div>
        <button onClick={ok} className="shrink-0 rounded-full border border-ink/20 px-6 py-2.5 text-sm font-semibold text-ink hover:bg-brand-50">Понятно</button>
      </div>
    </div>
  );
}
