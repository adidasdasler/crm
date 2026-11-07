import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { api, ApiError, fmtDate, fmtTime, rub } from '../lib/api';

type Info = {
  status: string; startsAt: string; price: number; resource: string; services: string[];
  salon: { name: string; phone: string | null; address: string | null }; canCancel: boolean; cancelBeforeHours: number; telegramUrl: string | null;
};
const STATUS: Record<string, string> = {
  SCHEDULED: 'Ожидает подтверждения', CONFIRMED: 'Подтверждена', ARRIVED: 'Вы в салоне',
  COMPLETED: 'Визит завершён', CANCELLED: 'Отменена', NO_SHOW: 'Неявка',
};

export function ManagePage() {
  const { slug = '', token = '' } = useParams();
  const [info, setInfo] = useState<Info | null>(null);
  const [tz, setTz] = useState('Europe/Moscow');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    Promise.all([api<Info>(`/public/${slug}/manage/${token}`), api<{ timezone: string }>(`/public/${slug}`)])
      .then(([i, s]) => { setInfo(i); setTz(s.timezone); })
      .catch((e: ApiError) => setErr(e.message));
  useEffect(() => { load(); }, [slug, token]);

  async function act(kind: 'confirm' | 'cancel') {
    if (kind === 'cancel' && !confirm('Отменить запись?')) return;
    setBusy(true);
    try {
      await api(`/public/${slug}/manage/${token}/${kind}`, { method: 'POST' });
      await load();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      {err && <p className="mb-4 rounded-xl bg-red-50 p-3 text-red-700">{err}</p>}
      {info && (
        <div className="card space-y-3">
          <p className="text-sm text-slate-500">{info.salon.name}</p>
          <h1 className="text-2xl font-bold first-letter:uppercase">{fmtDate(info.startsAt, tz)}, {fmtTime(info.startsAt, tz)}</h1>
          <p>{info.services.join(', ')} · {info.resource} · {rub(info.price)}</p>
          {info.salon.address && <p className="text-slate-500">{info.salon.address}</p>}
          <p className="inline-block rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-700">{STATUS[info.status] ?? info.status}</p>
          <div className="flex flex-col gap-2 pt-2">
            {info.status === 'SCHEDULED' && <button className="btn-primary" disabled={busy} onClick={() => act('confirm')}>Подтвердить, приду</button>}
            {info.canCancel && <button className="btn-ghost text-red-600" disabled={busy} onClick={() => act('cancel')}>Отменить запись</button>}
            {!info.canCancel && ['SCHEDULED', 'CONFIRMED'].includes(info.status) && (
              <p className="text-sm text-slate-500">Онлайн-отмена доступна не позднее чем за {info.cancelBeforeHours} ч. Позвоните в салон.</p>
            )}
            {info.salon.phone && <a className="btn-ghost" href={`tel:${info.salon.phone}`}>Позвонить в салон</a>}
            {info.telegramUrl && ['SCHEDULED', 'CONFIRMED'].includes(info.status) && (
              <a className="btn-ghost text-sky-700" href={info.telegramUrl} target="_blank" rel="noreferrer">Напоминания в Telegram</a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
