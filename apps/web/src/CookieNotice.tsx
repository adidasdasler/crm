import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { currentChoice, onChoice, setChoice, trackPage, YM_ID } from './lib/analytics';
import { tgInitData } from './lib/telegram';

const OLD_KEY = 'mioflow_cookie_notice';
const sawOldNotice = () => { try { return localStorage.getItem(OLD_KEY) === '1'; } catch { return false; } };

/**
 * Сообщение о cookie внизу экрана.
 * Метрика подключена — выбор «Принять все» / «Только необходимые», счётчик грузится только после «Принять».
 * Метрики нет — простое уведомление «Понятно» (необходимые cookie согласия не требуют).
 */
export function CookieNotice() {
  const { pathname } = useLocation();
  const [choice, setLocal] = useState(currentChoice);
  const [gotIt, setGotIt] = useState(sawOldNotice);
  useEffect(() => onChoice(() => setLocal(currentChoice())), []);
  // Учёт просмотров — при каждом переходе и сразу после согласия
  useEffect(() => { trackPage(pathname); }, [pathname, choice]);

  const decided = choice !== null || (!YM_ID && gotIt);
  if (decided || pathname === '/cookies' || pathname === '/admin' || pathname === '/master-photo-consent' || tgInitData()) return null;

  return (
    <div role="region" aria-label="Сообщение о cookie" className="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-4">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-lg sm:flex-row sm:items-center sm:gap-6 sm:p-5">
        <div className="flex-1 text-sm text-ink">
          <p className="font-semibold">На этом сайте используются cookie</p>
          <p className="mt-1 text-ink-muted">
            {YM_ID
              ? 'Необходимые — для входа в аккаунт и защиты от взлома. С вашего согласия — Яндекс Метрика, чтобы понимать, как улучшить сайт. Без рекламы.'
              : 'Только необходимые — для входа в аккаунт и защиты от взлома. Без рекламы и аналитики.'}{' '}
            <Link to="/cookies" className="text-brand-600 underline">Подробнее</Link>
          </p>
        </div>
        {YM_ID ? (
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <button onClick={() => setChoice('necessary')} className="rounded-full border border-ink/20 px-5 py-2.5 text-sm font-semibold text-ink hover:bg-brand-50">Только необходимые</button>
            <button onClick={() => setChoice('all')} className="rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90">Принять</button>
          </div>
        ) : (
          <button onClick={() => { try { localStorage.setItem(OLD_KEY, '1'); } catch { /* приватный режим */ } setGotIt(true); }} className="shrink-0 rounded-full border border-ink/20 px-6 py-2.5 text-sm font-semibold text-ink hover:bg-brand-50">Понятно</button>
        )}
      </div>
    </div>
  );
}

/** Кнопки смены выбора — на странице /cookies */
export function CookieSettings() {
  const [choice, setLocal] = useState(currentChoice);
  useEffect(() => onChoice(() => setLocal(currentChoice())), []);
  if (!YM_ID) return null;
  const btn = (c: 'all' | 'necessary', label: string) => (
    <button onClick={() => setChoice(c)} disabled={choice === c}
      className={`rounded-full px-5 py-2.5 text-sm font-semibold ${choice === c ? 'bg-ink text-white' : 'border border-ink/20 text-ink hover:bg-brand-50'}`}>{label}</button>
  );
  return (
    <div className="mt-3 rounded-2xl bg-brand-50 p-4">
      <p className="text-sm">Сейчас: <b>{choice === 'all' ? 'разрешена Яндекс Метрика' : choice === 'necessary' ? 'только необходимые cookie' : 'выбор не сделан — Метрика выключена'}</b></p>
      <div className="mt-3 flex flex-wrap gap-2">{btn('all', 'Разрешить Метрику')}{btn('necessary', 'Только необходимые')}</div>
    </div>
  );
}
