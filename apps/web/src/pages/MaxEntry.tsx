import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { maxApp, maxInitData, maxStartParam } from '../lib/max';
import { Logo } from '../Logo';

/**
 * Вход в мини-приложение MAX (этот адрес указывается в кабинете MAX для партнёров).
 * Ссылка https://max.ru/<бот>?startapp=<адрес салона> открывает сразу запись в этот салон.
 */
export function MaxEntry() {
  const nav = useNavigate();
  const [none, setNone] = useState(false);
  useEffect(() => {
    maxInitData();
    maxApp.ready();
    const slug = maxStartParam()?.toLowerCase();
    if (slug && /^[a-z0-9-]{3,32}$/.test(slug)) nav(`/b/${slug}?src=max`, { replace: true });
    else setNone(true);
  }, [nav]);
  if (!none) return null;
  return (
    <div className="mx-auto max-w-md px-6 py-16 text-center">
      <div className="flex justify-center"><Logo size={32} /></div>
      <h1 className="display mt-6 text-2xl">Онлайн-запись к мастеру</h1>
      <p className="mt-3 text-ink-muted">Откройте ссылку на запись от вашего салона — она откроется прямо здесь, в MAX. Напоминания о визите придут в чат с ботом.</p>
      <a href="/my" className="btn-ghost mt-6 inline-block">Мои записи</a>
    </div>
  );
}
