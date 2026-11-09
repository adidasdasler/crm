import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { api, ApiError, fmtDate, fmtTime, rub } from '../lib/api';

type Info = {
  status: string; startsAt: string; price: number; resource: string; services: string[];
  salon: { name: string; phone: string | null; address: string | null }; canCancel: boolean; cancelBeforeHours: number; telegramUrl: string | null;
  canReview?: boolean; review?: { rating: number; comment: string | null } | null; mapsLinks?: { yandex: string | null; twoGis: string | null };
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
          <p className="text-sm text-ink-muted">{info.salon.name}</p>
          <h1 className="display text-3xl first-letter:uppercase">{fmtDate(info.startsAt, tz)}, {fmtTime(info.startsAt, tz)}</h1>
          <p>{info.services.join(', ')} · {info.resource} · {rub(info.price)}</p>
          {info.salon.address && <p className="text-ink-muted">{info.salon.address}</p>}
          <p className="inline-block rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-700">{STATUS[info.status] ?? info.status}</p>
          <div className="flex flex-col gap-2 pt-2">
            {info.status === 'SCHEDULED' && <button className="btn-primary" disabled={busy} onClick={() => act('confirm')}>Подтвердить, приду</button>}
            {info.canCancel && <button className="btn-ghost text-red-600" disabled={busy} onClick={() => act('cancel')}>Отменить запись</button>}
            {!info.canCancel && ['SCHEDULED', 'CONFIRMED'].includes(info.status) && (
              <p className="text-sm text-ink-muted">Онлайн-отмена доступна не позднее чем за {info.cancelBeforeHours} ч. Позвоните в салон.</p>
            )}
            {info.salon.phone && <a className="btn-ghost" href={`tel:${info.salon.phone}`}>Позвонить в салон</a>}
            {info.canReview && <Rate slug={slug} token={token} info={info} onSaved={load} />}
            {info.telegramUrl && ['SCHEDULED', 'CONFIRMED'].includes(info.status) && (
              <a className="btn-ghost" href={info.telegramUrl} target="_blank" rel="noreferrer">Напоминания в Telegram</a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Оценка визита: звёзды 1–5, комментарий; после 4–5 — ссылки на отзыв в картах */
function Rate({ slug, token, info, onSaved }: { slug: string; token: string; info: Info; onSaved: () => void }) {
  const [rating, setRating] = useState(info.review?.rating ?? 0);
  const [comment, setComment] = useState(info.review?.comment ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(r = rating) {
    setBusy(true);
    try {
      const res = await api<{ message: string }>(`/public/${slug}/manage/${token}/review`, { method: 'POST', body: JSON.stringify({ rating: r, comment: comment.trim() || undefined }) });
      setMsg(res.message);
      onSaved();
    } catch (e) {
      setMsg((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }
  const good = (info.review?.rating ?? rating) >= 4;
  const maps = [info.mapsLinks?.yandex && { href: info.mapsLinks.yandex, label: 'Отзыв на Яндекс Картах' }, info.mapsLinks?.twoGis && { href: info.mapsLinks.twoGis, label: 'Отзыв в 2ГИС' }].filter(Boolean) as { href: string; label: string }[];
  return (
    <div className="space-y-3 rounded-3xl bg-brand-50 p-5 text-left">
      <p className="font-semibold">{info.review ? 'Ваша оценка' : 'Как прошёл визит?'}</p>
      <div className="flex gap-2" role="radiogroup" aria-label="Оценка от 1 до 5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} role="radio" aria-checked={rating === n} aria-label={`${n} из 5`} disabled={busy}
            onClick={() => { setRating(n); if (!info.review) void save(n); }}
            className={`grid h-12 w-12 place-items-center rounded-2xl text-2xl transition ${n <= rating ? 'bg-blush-300' : 'bg-white ring-1 ring-brand-100'}`}>
            {n <= rating ? '★' : '☆'}
          </button>
        ))}
      </div>
      {(info.review || rating > 0) && (
        <>
          <textarea className="input" rows={3} maxLength={1000} placeholder={rating && rating <= 3 ? 'Что пошло не так? Владелец салона прочитает' : 'Пара слов мастеру (необязательно)'} value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className="btn-primary w-full" disabled={busy || !rating} onClick={() => save()}>Сохранить</button>
        </>
      )}
      {msg && <p className="text-sm text-ink-muted">{msg}</p>}
      {good && maps.length > 0 && info.review && (
        <div className="grid gap-2">{maps.map((m) => <a key={m.href} className="btn-ghost" href={m.href} target="_blank" rel="noreferrer">⭐ {m.label}</a>)}</div>
      )}
    </div>
  );
}
