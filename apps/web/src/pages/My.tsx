import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Mark } from '../Logo';
import { api, ApiError, fmtDate, fmtTime, rub } from '../lib/api';
import { calendarUrl, forgetBooking, myBookings, MyRef } from '../lib/my';
import { ClientBooking, ClientMe, clientMe } from '../lib/client';

type Visit = {
  ref: MyRef;
  status: string; startsAt: string; price: number; resource: string; services: string[];
  salon: { name: string; phone: string | null; address: string | null; timezone?: string };
  resourceId?: string; serviceIds?: string[];
};

const STATUS: Record<string, { text: string; cls: string }> = {
  SCHEDULED: { text: 'Ожидает подтверждения', cls: 'bg-brand-50 text-brand-700' },
  CONFIRMED: { text: 'Подтверждена', cls: 'bg-emerald-50 text-emerald-700' },
  ARRIVED: { text: 'Вы в салоне', cls: 'bg-emerald-50 text-emerald-700' },
  COMPLETED: { text: 'Были', cls: 'bg-slate-100 text-slate-600' },
  CANCELLED: { text: 'Отменена', cls: 'bg-red-50 text-red-700' },
  NO_SHOW: { text: 'Не пришли', cls: 'bg-amber-50 text-amber-700' },
};
const ACTIVE = ['SCHEDULED', 'CONFIRMED', 'ARRIVED'];

/** «Мои записи»: все записи с этого устройства во все салоны — где, когда и к кому */
export function MyPage() {
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [me, setMe] = useState<ClientMe | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Мои записи — MioFlow';
    (async () => {
      const user = await clientMe();
      setMe(user);
      const refs = myBookings();
      let server: Visit[] = [];
      if (user) {
        // Записи, сохранённые на этом телефоне, привязываем к кабинету — они появятся и на других устройствах
        if (refs.length) await api('/client/claim', { method: 'POST', body: JSON.stringify({ refs: refs.map(({ slug, token }) => ({ slug, token })) }) }).catch(() => null);
        server = (await api<ClientBooking[]>('/client/bookings').catch(() => [] as ClientBooking[])).map((b) => ({
          ref: { slug: b.slug, token: b.token, at: b.startsAt, salon: b.salon.name },
          status: b.status, startsAt: b.startsAt, price: b.price, resource: b.resource, services: b.services,
          salon: b.salon, serviceIds: b.serviceIds, resourceId: b.resourceId,
        }));
      }
      const known = new Set(server.map((v) => v.ref.token));
      const local = await Promise.all(
        refs.filter((r) => !known.has(r.token)).map((ref) =>
          api<Omit<Visit, 'ref'>>(`/public/${ref.slug}/manage/${ref.token}`)
            .then((v) => ({ ...v, ref }))
            .catch((e: ApiError) => {
              // Запись удалили или салон закрылся — убираем из списка
              if (e.status === 404) forgetBooking(ref.token);
              return null;
            }),
        ),
      );
      setVisits([...server, ...(local.filter(Boolean) as Visit[])]);
    })();
  }, []);

  async function logout() {
    await api('/client/logout', { method: 'POST' }).catch(() => null);
    location.reload();
  }
  async function removeAccount() {
    if (!confirm('Удалить кабинет? Записи в салонах останутся, но в кабинете их больше не будет. Это действие нельзя отменить.')) return;
    await api('/client/me', { method: 'DELETE' }).catch(() => null);
    location.reload();
  }
  async function resend() {
    try { await api('/client/verify/resend', { method: 'POST' }); setNotice('Письмо отправлено — проверьте почту'); } catch (e) { setNotice((e as ApiError).message); }
  }

  const now = Date.now();
  const upcoming = (visits ?? []).filter((v) => ACTIVE.includes(v.status) && +new Date(v.startsAt) > now - 3 * 3600_000).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = (visits ?? []).filter((v) => !upcoming.includes(v)).sort((a, b) => b.startsAt.localeCompare(a.startsAt));

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-xl space-y-6 px-4 pb-16 pt-8">
        <header className="space-y-1">
          <div className="flex items-start justify-between gap-3">
            <h1 className="display text-3xl">Мои записи</h1>
            {me && <button className="pt-2 text-sm font-semibold text-brand-600" onClick={logout}>Выйти</button>}
          </div>
          <p className="text-ink-muted">{me ? `${me.name}${me.email ? ` · ${me.email}` : ''} — записи во всех салонах на MioFlow, на любом устройстве.` : 'Все ваши записи через MioFlow на этом телефоне: где, когда и к кому.'}</p>
        </header>
        {me === null && (
          <div className="card space-y-3 bg-brand-50">
            <p className="font-semibold">Войдите, чтобы записи были на любом устройстве</p>
            <p className="text-sm text-ink-muted">Сейчас список хранится только в этом браузере. В кабинете появятся и записи, которые салон сделал на ваш email или телефон.</p>
            <div className="flex gap-2">
              <Link className="btn-primary flex-1" to="/account/login">Войти</Link>
              <Link className="btn-ghost flex-1" to="/account/register">Регистрация</Link>
            </div>
          </div>
        )}
        {me && me.email && !me.emailVerified && (
          <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
            Подтвердите email по ссылке из письма — тогда здесь появятся и записи, которые салоны сделали на {me.email}.{' '}
            <button className="font-semibold underline" onClick={resend}>Отправить письмо ещё раз</button>
            {notice && <p className="mt-1">{notice}</p>}
          </div>
        )}

        {visits === null && <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="card h-32 animate-pulse bg-brand-50" />)}</div>}

        {visits?.length === 0 && (
          <div className="card space-y-2 py-10 text-center">
            <p className="text-lg font-semibold">Пока пусто</p>
            <p className="text-ink-muted">Запишитесь онлайн по ссылке салона или мастера — запись появится здесь. Если записывались с другого телефона, откройте ссылку из напоминания — она добавится сюда.</p>
          </div>
        )}

        {upcoming.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Предстоящие</h2>
            {upcoming.map((v) => <Card key={v.ref.token} v={v} />)}
          </section>
        )}
        {past.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">История</h2>
            {past.map((v) => <Card key={v.ref.token} v={v} past />)}
          </section>
        )}

        <p className="text-xs text-ink-muted">
          {me ? 'Чтобы визиты были и в календаре телефона, нажимайте «В календарь».' : 'Список хранится только в этом браузере. Чтобы визиты не потерялись при смене телефона, войдите в кабинет или добавляйте их в календарь — кнопка «В календарь».'}
        </p>
        {me && <button className="text-xs text-ink-muted underline" onClick={removeAccount}>Удалить кабинет</button>}
        <footer className="flex items-center justify-center gap-2 text-xs text-ink-muted"><Mark size={16} /> <Link to="/" className="font-semibold underline">MioFlow</Link></footer>
      </div>
    </div>
  );
}

function Card({ v, past }: { v: Visit; past?: boolean }) {
  const tz = v.salon.timezone ?? 'Europe/Moscow';
  const st = STATUS[v.status] ?? { text: v.status, cls: 'bg-slate-100 text-slate-600' };
  const manage = `/b/${v.ref.slug}/manage/${v.ref.token}`;
  const again = v.serviceIds?.length ? `/b/${v.ref.slug}?s=${v.serviceIds.join(',')}${v.resourceId ? `&m=${v.resourceId}` : ''}` : `/b/${v.ref.slug}`;
  return (
    <article className={`card space-y-2 ${past ? 'opacity-90' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{v.salon.name}</p>
          {v.salon.address && <p className="text-sm text-ink-muted">{v.salon.address}</p>}
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${st.cls}`}>{st.text}</span>
      </div>
      <p className="text-lg font-semibold first-letter:uppercase">{fmtDate(v.startsAt, tz)}, {fmtTime(v.startsAt, tz)}</p>
      <p className="text-ink-muted">{v.services.join(', ')} · мастер {v.resource} · {rub(v.price)}</p>
      <div className="flex flex-wrap gap-2 pt-1 text-sm font-semibold">
        <a href={manage} className="rounded-full bg-brand-600 px-4 py-2 text-white">{past ? 'Подробнее' : 'Перенести или отменить'}</a>
        {!past && <a href={calendarUrl(v.ref.slug, v.ref.token)} className="rounded-full px-4 py-2 ring-1 ring-brand-100">В календарь</a>}
        <a href={again} className="rounded-full px-4 py-2 ring-1 ring-brand-100">Записаться снова</a>
        {v.salon.phone && <a href={`tel:${v.salon.phone}`} className="rounded-full px-4 py-2 ring-1 ring-brand-100">Позвонить</a>}
      </div>
    </article>
  );
}
