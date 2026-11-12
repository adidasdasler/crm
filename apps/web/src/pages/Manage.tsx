import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { calendarUrl, rememberBooking } from '../lib/my';
import { api, ApiError, dateInTz, fmtDate, fmtTime, rub } from '../lib/api';

type Info = {
  status: string; startsAt: string; price: number; resource: string; services: string[];
  salon: { name: string; phone: string | null; address: string | null }; resourceId?: string; serviceIds?: string[]; canCancel: boolean; canReschedule?: boolean; maxDaysAhead?: number; cancelBeforeHours: number; telegramUrl: string | null;
  wallet?: { money: number; bonus: number; passes: { name: string; kind: string; visitsLeft: number | null; expiresAt: string }[] };
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
  const [moving, setMoving] = useState(false);

  const load = () =>
    Promise.all([api<Info>(`/public/${slug}/manage/${token}`), api<{ timezone: string }>(`/public/${slug}`)])
      .then(([i, s]) => { setInfo(i); setTz(s.timezone); rememberBooking({ slug, token, at: i.startsAt, salon: i.salon.name }); })
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
          {info.wallet && (info.wallet.money + info.wallet.bonus > 0 || info.wallet.passes.length > 0) && (
            <div className="space-y-1 rounded-2xl bg-blush-100 p-4 text-sm">
              {info.wallet.money + info.wallet.bonus > 0 && <p><b>На вашем счёте: {(info.wallet.money + info.wallet.bonus).toLocaleString('ru-RU')} ₽</b>{info.wallet.bonus > 0 ? ` (из них бонусы ${info.wallet.bonus.toLocaleString('ru-RU')} ₽)` : ''}</p>}
              {info.wallet.passes.map((p) => (
                <p key={p.name + p.expiresAt}>Абонемент «{p.name}»: {p.kind === 'VISITS' ? `осталось ${p.visitsLeft}` : 'безлимит'} · до {new Date(p.expiresAt).toLocaleDateString('ru-RU')}</p>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-2 pt-2">
            {info.status === 'SCHEDULED' && <button className="btn-primary" disabled={busy} onClick={() => act('confirm')}>Подтвердить, приду</button>}
            {info.canReschedule && !moving && <button className="btn-ghost" disabled={busy} onClick={() => setMoving(true)}>Перенести на другое время</button>}
            {moving && info.serviceIds && info.resourceId && (
              <Reschedule slug={slug} token={token} tz={tz} info={info} onClose={() => setMoving(false)} onDone={() => { setMoving(false); void load(); }} />
            )}
            {info.canCancel && <button className="btn-ghost text-red-600" disabled={busy} onClick={() => act('cancel')}>Отменить запись</button>}
            {!info.canCancel && ['SCHEDULED', 'CONFIRMED'].includes(info.status) && (
              <p className="text-sm text-ink-muted">Онлайн-отмена доступна не позднее чем за {info.cancelBeforeHours} ч. Позвоните в салон.</p>
            )}
            {info.salon.phone && <a className="btn-ghost" href={`tel:${info.salon.phone}`}>Позвонить в салон</a>}
            {info.canReview && <Rate slug={slug} token={token} info={info} onSaved={load} />}
            {['SCHEDULED', 'CONFIRMED'].includes(info.status) && <a className="btn-ghost" href={calendarUrl(slug, token)}>📅 Добавить в календарь</a>}
            {info.serviceIds?.length ? (
              <a className="btn-ghost" href={`/b/${slug}?s=${info.serviceIds.join(',')}${info.resourceId ? `&m=${info.resourceId}` : ''}`}>Записаться снова</a>
            ) : null}
            <Link to="/my" className="pt-1 text-center text-sm font-semibold text-brand-600 underline underline-offset-4">Все мои записи</Link>
            {info.telegramUrl && ['SCHEDULED', 'CONFIRMED'].includes(info.status) && (
              <a className="btn-ghost" href={info.telegramUrl} target="_blank" rel="noreferrer">Напоминания в Telegram</a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Перенос: тот же мастер и услуги, выбираем день и свободное время */
function Reschedule({ slug, token, tz, info, onClose, onDone }: { slug: string; token: string; tz: string; info: Info; onClose: () => void; onDone: () => void }) {
  const days = Array.from({ length: Math.min(info.maxDaysAhead ?? 30, 21) }, (_, i) => dateInTz(tz, i));
  const [date, setDate] = useState(days[0]);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setSlots(null);
    setTime(null);
    const q = new URLSearchParams({ date, serviceIds: info.serviceIds!.join(','), resourceId: info.resourceId! });
    api<{ slots: string[] }[]>(`/public/${slug}/slots?${q}`).then((r) => setSlots(r[0]?.slots ?? [])).catch(() => setSlots([]));
  }, [date, slug, info.serviceIds, info.resourceId]);
  const wd = (d: string) => new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
  async function save() {
    if (!time) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/public/${slug}/manage/${token}/reschedule`, { method: 'POST', body: JSON.stringify({ startsAt: time }) });
      onDone();
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 rounded-3xl bg-brand-50 p-4 text-left">
      <div className="flex items-center justify-between">
        <p className="font-semibold">Новое время · мастер {info.resource}</p>
        <button className="text-sm font-medium text-brand-600" onClick={onClose}>Отмена</button>
      </div>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {days.map((d) => (
          <button key={d} onClick={() => setDate(d)} className={`w-12 shrink-0 rounded-2xl py-2 text-center ${d === date ? 'bg-brand-600 text-white' : 'bg-white'}`}>
            <span className="block text-xs">{wd(d)}</span>
            <span className="block font-bold">{+d.slice(8)}</span>
          </button>
        ))}
      </div>
      {slots === null ? <p className="text-sm text-ink-muted">Ищем свободное время…</p> : slots.length === 0 ? (
        <p className="text-sm text-ink-muted">В этот день свободного времени нет — выберите другой.</p>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {slots.map((s) => (
            <button key={s} onClick={() => setTime(s)} className={`rounded-xl py-2 font-semibold ${time === s ? 'bg-brand-600 text-white' : 'bg-white'}`}>{fmtTime(s, tz)}</button>
          ))}
        </div>
      )}
      {err && <p className="text-sm text-red-700">{err}</p>}
      <button className="btn-primary w-full" disabled={!time || busy} onClick={save}>
        {time ? `Перенести на ${fmtDate(time, tz)}, ${fmtTime(time, tz)}` : 'Выберите время'}
      </button>
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
