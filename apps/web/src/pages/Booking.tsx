import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Mark } from '../Logo';
import { tg, tgFirstName, tgInitData } from '../lib/telegram';
import { api, ApiError, dateInTz, fmtDate, fmtTime, minutes, rub } from '../lib/api';

type Hours = ({ day: string; from: string; to: string } | null)[];
type Salon = {
  name: string; slug: string; phone: string | null; address: string | null; timezone: string; available: boolean; maxDaysAhead: number;
  about?: string | null; links?: Partial<Record<'site' | 'vk' | 'telegram' | 'max' | 'instagram' | 'whatsapp' | 'yandexMaps' | 'twoGis', string>>;
  hours?: Hours; hoursText?: string; industry?: { label: string; terms: { staff: string } };
  loyalty?: {
    tiers: { amount: number; bonus: number }[];
    plans: { name: string; description: string | null; kind: 'VISITS' | 'UNLIMITED'; visits: number | null; validityDays: number; price: number; timeRule: { days?: number[]; from?: string; to?: string } | null }[];
  };
};
type Service = { id: string; name: string; description: string | null; price: number; duration: number; categoryId: string | null; comboOf?: string[] };
type Nearest = { resourceId: string; name: string; at: string };
type Category = { id: string; name: string };
type Master = { id: string; name: string; position: string | null };
type SlotsByMaster = { resourceId: string; name: string; slots: string[] }[];
type Booked = { id: string; startsAt: string; price: number; resource: string; services: string[]; manageUrl: string; telegramUrl: string | null; messengers?: { telegram: string | null; max: string | null; vk: string | null }; telegramLinked?: boolean };

/** Источник перехода: ?src=yandex, ?src=2gis, ?src=vk… — салон видит в отчёте, откуда приходят клиенты */
function readRef(): string | undefined {
  try {
    const q = new URLSearchParams(location.search).get('src')?.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
    if (q) sessionStorage.setItem('mioflow_ref', q);
    return q || sessionStorage.getItem('mioflow_ref') || undefined;
  } catch {
    return undefined;
  }
}

type Step = 'services' | 'master' | 'time' | 'contacts' | 'done';

export function BookingPage() {
  const { slug = '' } = useParams();
  const [salon, setSalon] = useState<Salon | null>(null);
  const [catalog, setCatalog] = useState<{ categories: Category[]; services: Service[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>('services');
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [masters, setMasters] = useState<Master[]>([]);
  const [nearest, setNearest] = useState<Nearest[]>([]);
  const [masterId, setMasterId] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<SlotsByMaster | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [booked, setBooked] = useState<Booked | null>(null);

  useEffect(() => {
    Promise.all([api<Salon>(`/public/${slug}`), api<typeof catalog>(`/public/${slug}/services`)])
      .then(([s, c]) => {
        setSalon(s);
        setCatalog(c);
        setDate(dateInTz(s.timezone));
        document.title = `Запись — ${s.name}`;
        tg.ready();
      })
      .catch((e: ApiError) => setError(e.status === 404 ? 'Салон не найден' : e.message));
  }, [slug]);

  const selected = useMemo(() => catalog?.services.filter((s) => serviceIds.includes(s.id)) ?? [], [catalog, serviceIds]);
  const total = selected.reduce((a, s) => ({ price: a.price + s.price, duration: a.duration + s.duration }), { price: 0, duration: 0 });

  useEffect(() => {
    if (step !== 'master') return;
    api<Master[]>(`/public/${slug}/resources?serviceIds=${serviceIds.join(',')}`).then(setMasters).catch(() => setMasters([]));
    setNearest([]);
    api<Nearest[]>(`/public/${slug}/nearest?serviceIds=${serviceIds.join(',')}`).then(setNearest).catch(() => setNearest([]));
  }, [step, slug, serviceIds]);

  useEffect(() => {
    if (step !== 'time' || !date) return;
    setSlots(null);
    const q = new URLSearchParams({ date, serviceIds: serviceIds.join(',') });
    if (masterId) q.set('resourceId', masterId);
    api<SlotsByMaster>(`/public/${slug}/slots?${q}`).then(setSlots).catch(() => setSlots([]));
  }, [step, date, masterId, slug, serviceIds]);

  const nearestOf = (id: string) => nearest.find((n) => n.resourceId === id);

  /** «Любой мастер» — объединяем свободные времена всех мастеров. */
  const times = useMemo(() => [...new Set((slots ?? []).flatMap((r) => r.slots))].sort(), [slots]);

  if (error) return <Shell><div className="card text-center py-12"><p className="text-lg font-semibold">{error}</p></div></Shell>;
  if (!salon || !catalog) return <Shell><Skeleton /></Shell>;
  if (!salon.available) {
    return (
      <Shell salon={salon}>
        <div className="card text-center py-10">
          <p className="text-lg font-semibold">Онлайн-запись временно недоступна</p>
          {salon.phone && <a className="btn-primary mt-4" href={`tel:${salon.phone}`}>Позвонить в салон</a>}
        </div>
      </Shell>
    );
  }

  const tz = salon.timezone;
  const days = Array.from({ length: Math.min(salon.maxDaysAhead, 21) }, (_, i) => dateInTz(tz, i));

  return (
    <Shell salon={salon} full={step === 'services'}>
      {step !== 'done' && <Progress step={step} />}

      {step === 'services' && (
        <section className="space-y-6">
          <h2 className="display text-2xl">Что делаем?</h2>
          {[...catalog.categories, { id: null as unknown as string, name: catalog.categories.length ? 'Другое' : '' }].map((cat) => {
            const items = catalog.services.filter((s) => s.categoryId === (cat.id ?? null));
            if (!items.length) return null;
            return (
              <div key={cat.id ?? 'none'} className="space-y-2">
                {cat.name && <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{cat.name}</h3>}
                {items.map((s) => {
                  const on = serviceIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => setServiceIds(on ? serviceIds.filter((x) => x !== s.id) : serviceIds.length < 5 ? [...serviceIds, s.id] : serviceIds)}
                      className={`card flex w-full items-start justify-between gap-4 text-left transition ${on ? 'bg-brand-50 ring-2 ring-brand-600' : 'hover:ring-brand-200'}`}
                    >
                      <div>
                        <p className="font-semibold">{s.name}</p>
                        <ComboBadge s={s} all={catalog.services} />
                        {s.description && <p className="mt-1 text-sm text-ink-muted">{s.description}</p>}
                        <p className="mt-1 text-sm text-ink-muted">{minutes(s.duration)}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="font-semibold">{rub(s.price)}</span>
                        <span className={`grid h-6 w-6 place-items-center rounded-full border-2 text-sm ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-brand-200'}`}>{on && '✓'}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
          <Portfolio slug={slug} />
          <BottomBar disabled={!serviceIds.length} onNext={() => setStep('master')} label={serviceIds.length ? `Далее · ${rub(total.price)} · ${minutes(total.duration)}` : 'Выберите услугу'} />
        </section>
      )}

      {step === 'master' && (
        <section className="space-y-3">
          <Back onClick={() => setStep('services')} />
          <h2 className="display text-2xl">К кому?</h2>
          {nearest[0] && (
            <button
              onClick={() => { setMasterId(nearest[0].resourceId); setDate(new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(nearest[0].at))); setTime(nearest[0].at); setStep('contacts'); }}
              className="flex w-full items-center justify-between gap-3 rounded-3xl bg-ink p-4 text-left text-white"
            >
              <div>
                <p className="text-sm text-[#C9CCF2]">Ближайшее свободное время</p>
                <p className="text-lg font-semibold">{when(nearest[0].at, tz)} · {nearest[0].name}</p>
              </div>
              <span className="shrink-0 rounded-full bg-blush-300 px-4 py-2 text-sm font-semibold text-ink">Записаться</span>
            </button>
          )}
          <button onClick={() => { setMasterId(null); setStep('time'); }} className="card flex w-full items-center gap-4 text-left hover:ring-brand-500">
            <Avatar name="✦" />
            <div><p className="font-semibold">Любой мастер</p><p className="text-sm text-ink-muted">{nearest[0] ? `Ближайшее: ${when(nearest[0].at, tz)}` : 'Покажем всё свободное время'}</p></div>
          </button>
          {masters.map((m) => (
            <button key={m.id} onClick={() => { setMasterId(m.id); setStep('time'); }} className="card flex w-full items-center gap-4 text-left hover:ring-brand-500">
              <Avatar name={m.name} />
              <div>
                <p className="font-semibold">{m.name}</p>
                {m.position && <p className="text-sm text-ink-muted">{m.position}</p>}
                {nearestOf(m.id) && <p className="text-sm font-medium text-brand-600">Ближайшее: {when(nearestOf(m.id)!.at, tz)}</p>}
              </div>
            </button>
          ))}
        </section>
      )}

      {step === 'time' && (
        <section className="space-y-4">
          <Back onClick={() => setStep('master')} />
          <h2 className="display text-2xl">Когда удобно?</h2>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
            {days.map((d) => {
              const dt = new Date(`${d}T12:00:00Z`);
              const on = d === date;
              return (
                <button key={d} onClick={() => { setDate(d); setTime(null); }} className={`flex w-14 shrink-0 flex-col items-center rounded-full py-2.5 ${on ? 'bg-brand-600 text-white' : 'bg-white ring-1 ring-brand-100'}`}>
                  <span className="text-xs capitalize opacity-80">{dt.toLocaleDateString('ru-RU', { weekday: 'short', timeZone: 'UTC' })}</span>
                  <span className="text-lg font-semibold">{dt.getUTCDate()}</span>
                </button>
              );
            })}
          </div>
          {slots === null ? (
            <Skeleton />
          ) : times.length === 0 ? (
            <div className="card py-8 text-center text-ink-muted">На этот день свободного времени нет — выберите другой</div>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {times.map((t) => (
                <button key={t} onClick={() => setTime(t)} className={`rounded-full py-3 font-semibold tabular-nums ${time === t ? 'bg-blush-300 text-ink ring-2 ring-blush-300' : 'bg-white ring-1 ring-brand-100 hover:ring-brand-600'}`}>
                  {fmtTime(t, tz)}
                </button>
              ))}
            </div>
          )}
          <BottomBar disabled={!time} onNext={() => setStep('contacts')} label="Далее" />
        </section>
      )}

      {step === 'contacts' && time && (
        <Contacts
          slug={slug}
          tz={tz}
          summary={{ services: selected, time, total, master: masters.find((m) => m.id === masterId)?.name ?? 'Любой мастер' }}
          payload={{ serviceIds, resourceId: masterId, startsAt: time }}
          onBack={() => setStep('time')}
          onDone={(b) => { setBooked(b); setStep('done'); }}
          onTaken={() => { setTime(null); setStep('time'); }}
        />
      )}

      {step === 'done' && booked && (
        <section className="card space-y-4 py-8 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-blush-300 text-3xl text-ink">✓</div>
          <h2 className="display text-3xl">Вы записаны!</h2>
          <p className="text-lg first-letter:uppercase">{fmtDate(booked.startsAt, tz)}, {fmtTime(booked.startsAt, tz)}</p>
          <p className="text-ink-muted">{booked.services.join(', ')} · мастер {booked.resource} · {rub(booked.price)}</p>
          {salon.address && <p className="text-ink-muted">{salon.address}</p>}
          {booked.telegramLinked ? (
            <div className="space-y-3 rounded-3xl bg-brand-50 p-5">
              <p className="font-semibold">Напомним здесь, в Telegram</p>
              <p className="text-sm text-ink-muted">За сутки и за 2 часа — с кнопками «Подтвердить» и «Отменить».</p>
              <button className="btn-primary w-full" onClick={() => tg.close()}>Готово</button>
            </div>
          ) : <Messengers booked={booked} />}
          <p className="text-sm text-ink-muted">По этой ссылке можно подтвердить или отменить запись:</p>
          <a className="btn-ghost" href={booked.manageUrl}>Управлять записью</a>
        </section>
      )}
    </Shell>
  );
}

function Contacts(props: {
  slug: string;
  tz: string;
  summary: { services: Service[]; time: string; total: { price: number; duration: number }; master: string };
  payload: { serviceIds: string[]; resourceId: string | null; startsAt: string };
  onBack: () => void;
  onDone: (b: Booked) => void;
  onTaken: () => void;
}) {
  const [name, setName] = useState(() => tgFirstName() ?? '');
  const [phone, setPhone] = useState('+7 ');
  const [email, setEmail] = useState('');
  const [comment, setComment] = useState('');
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState(''); // honeypot
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const b = await api<Booked>(`/public/${props.slug}/book`, {
        method: 'POST',
        body: JSON.stringify({ ...props.payload, name, phone, email: email.trim() || undefined, ref: readRef() ?? (tgInitData() ? 'telegram' : undefined), tgInitData: tgInitData() ?? undefined, comment: comment || undefined, consent, website: website || undefined }),
      });
      props.onDone(b);
    } catch (e) {
      const ae = e as ApiError;
      if (ae.code === 'SLOT_TAKEN') {
        alert('Это время только что заняли. Выберите другое.');
        props.onTaken();
      } else setErr(ae.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Back onClick={props.onBack} />
      <div className="card space-y-1">
        <p className="font-semibold first-letter:uppercase">{fmtDate(props.summary.time, props.tz)}, {fmtTime(props.summary.time, props.tz)}</p>
        <p className="text-sm text-ink-muted">{props.summary.services.map((s) => s.name).join(', ')}</p>
        <p className="text-sm text-ink-muted">{props.summary.master} · {minutes(props.summary.total.duration)} · <b>{rub(props.summary.total.price)}</b></p>
      </div>
      <h2 className="display text-2xl">Как с вами связаться</h2>
      <input className="input" required placeholder="Имя" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      <input className="input" required type="tel" placeholder="+7 999 123-45-67" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
      <input className="input" type="email" placeholder="Email для напоминаний (необязательно)" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      <textarea className="input" rows={2} maxLength={500} placeholder="Пожелания к визиту (необязательно)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <input className="hidden" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} aria-hidden />
      <label className="flex items-start gap-3 text-sm text-ink-muted">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-600" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>Даю <Link className="text-brand-600 underline" to={`/b/${props.slug}/consent`} target="_blank">согласие на обработку персональных данных</Link></span>
      </label>
      {err && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{err}</p>}
      <button className="btn-primary w-full" disabled={busy || !consent || name.trim().length < 1}>{busy ? 'Записываем…' : 'Записаться'}</button>
    </form>
  );
}

function Shell({ salon, full, children }: { salon?: Salon; full?: boolean; children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      {salon && (full ? <SalonHero salon={salon} /> : (
        <header className="mx-auto max-w-xl px-4 pt-6">
          <h1 className="display text-2xl">{salon.name}</h1>
          {salon.address && <p className="text-sm text-ink-muted">{salon.address}</p>}
        </header>
      ))}
      <div className="mx-auto max-w-xl px-4 pb-28 pt-6">
        {children}
        <footer className="mt-12 flex items-center justify-center gap-2 text-xs text-ink-muted"><Mark size={16} /> Онлайн-запись через <Link to="/" className="font-semibold underline">MioFlow</Link></footer>
      </div>
    </div>
  );
}

const LINK_LABELS: Record<string, string> = { yandexMaps: 'Яндекс Карты', twoGis: '2ГИС', vk: 'ВКонтакте', telegram: 'Telegram', max: 'MAX', instagram: 'Instagram', whatsapp: 'WhatsApp', site: 'Сайт' };

/** Открыто ли сейчас по часам работы салона (в его часовом поясе) */
function openNow(hours: Hours | undefined, tz: string): { open: boolean; text: string } | null {
  if (!hours) return null;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.find((p) => p.type === 'weekday')!.value);
  const now = `${parts.find((p) => p.type === 'hour')!.value}:${parts.find((p) => p.type === 'minute')!.value}`;
  const today = hours[wd];
  if (today && now >= today.from && now < today.to) return { open: true, text: `до ${today.to}` };
  if (today && now < today.from) return { open: false, text: `откроется в ${today.from}` };
  for (let k = 1; k <= 7; k++) {
    const h = hours[(wd + k) % 7];
    if (h) return { open: false, text: `откроется ${k === 1 ? 'завтра' : ['в пн', 'во вт', 'в ср', 'в чт', 'в пт', 'в сб', 'в вс'][(wd + k) % 7]} в ${h.from}` };
  }
  return null;
}

/** Мини-сайт салона: шапка с описанием, часами, адресом и ссылками */
function SalonHero({ salon }: { salon: Salon }) {
  const [more, setMore] = useState(false);
  const status = openNow(salon.hours, salon.timezone);
  const route = salon.links?.yandexMaps ?? (salon.address ? `https://yandex.ru/maps/?text=${encodeURIComponent(salon.address)}` : null);
  const links = Object.entries(salon.links ?? {}).filter(([k, v]) => v && k !== 'yandexMaps');
  return (
    <header className="relative overflow-hidden bg-ink pb-8 pt-8 text-white">
      <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-brand-600/60 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 left-0 h-56 w-56 rounded-full bg-blush-300/30 blur-3xl" />
      <div className="relative mx-auto max-w-xl space-y-4 px-4">
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-3xl bg-blush-300 font-display text-3xl text-ink">{salon.name.replace(/[«»"']/g, '').slice(0, 1)}</div>
          <div className="min-w-0">
            {salon.industry && <p className="text-sm text-[#C9CCF2]">{salon.industry.label}</p>}
            <h1 className="display text-3xl leading-tight">{salon.name}</h1>
          </div>
        </div>
        {status && (
          <p className="text-sm">
            <span className={`font-semibold ${status.open ? 'text-[#7BE3A6]' : 'text-blush-300'}`}>{status.open ? 'Открыто' : 'Закрыто'}</span>{' '}
            <span className="text-[#C9CCF2]">{status.text}</span>
          </p>
        )}
        {salon.about && (
          <p className={`text-[#E3E5F7] ${more ? '' : 'line-clamp-3'}`} onClick={() => setMore(true)}>{salon.about}</p>
        )}
        <div className="flex flex-wrap gap-2 text-sm font-semibold">
          {route && <a href={route} target="_blank" rel="noreferrer" className="rounded-full bg-white px-4 py-2 text-ink">Маршрут</a>}
          {salon.phone && <a href={`tel:${salon.phone}`} className="rounded-full bg-white/10 px-4 py-2 ring-1 ring-white/20">Позвонить</a>}
          {links.map(([k, v]) => <a key={k} href={v} target="_blank" rel="noreferrer" className="rounded-full bg-white/10 px-4 py-2 ring-1 ring-white/20">{LINK_LABELS[k] ?? k}</a>)}
        </div>
        <Offers salon={salon} />
        {(salon.address || salon.hoursText) && (
          <div className="space-y-1 rounded-2xl bg-white/[0.07] p-4 text-sm ring-1 ring-white/10">
            {salon.address && <p><span className="text-[#C9CCF2]">Адрес:</span> {salon.address}</p>}
            {salon.hoursText && <p><span className="text-[#C9CCF2]">Часы:</span> {salon.hoursText}</p>}
          </div>
        )}
      </div>
    </header>
  );
}

const STEPS: Step[] = ['services', 'master', 'time', 'contacts'];
function Progress({ step }: { step: Step }) {
  const i = STEPS.indexOf(step);
  return (
    <div className="mb-6 flex gap-1.5">
      {STEPS.map((s, j) => <div key={s} className={`h-1.5 flex-1 rounded-full ${j <= i ? 'bg-brand-600' : 'bg-brand-100'}`} />)}
    </div>
  );
}
function BottomBar({ disabled, onNext, label }: { disabled: boolean; onNext: () => void; label: string }) {
  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-brand-50 bg-white/90 p-4 backdrop-blur" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      <div className="mx-auto max-w-xl"><button className="btn-primary w-full" disabled={disabled} onClick={onNext}>{label}</button></div>
    </div>
  );
}
const Back = ({ onClick }: { onClick: () => void }) => <button type="button" onClick={onClick} className="text-sm font-medium text-brand-600">← Назад</button>;
const Avatar = ({ name }: { name: string }) => (
  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-50 font-display text-xl text-brand-700">{name.slice(0, 1)}</div>
);
const Skeleton = () => <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-3xl bg-brand-50" />)}</div>;

/** Напоминания бесплатно в мессенджере на выбор: клиент нажимает кнопку, бот привязывается к записи */
function Messengers({ booked }: { booked: Booked }) {
  const m = booked.messengers ?? { telegram: booked.telegramUrl, max: null, vk: null };
  const links = [
    { href: m.telegram, label: 'Telegram', cls: 'bg-[#229ED9] text-white' },
    { href: m.max, label: 'MAX', cls: 'bg-gradient-to-r from-[#2E6BFF] to-[#9B3BFF] text-white' },
    { href: m.vk, label: 'ВКонтакте', cls: 'bg-[#0077FF] text-white' },
  ].filter((l) => l.href);
  if (!links.length) return null;
  return (
    <div className="space-y-3 rounded-3xl bg-brand-50 p-5">
      <p className="font-semibold">Получайте напоминания в мессенджере</p>
      <p className="text-sm text-ink-muted">Напомним за сутки и за 2 часа. Подтвердить или отменить — одной кнопкой.</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {links.map((l) => (
          <a key={l.label} className={`rounded-2xl px-4 py-3 text-center font-semibold transition hover:opacity-90 ${l.cls}`} href={l.href!} target="_blank" rel="noreferrer">
            {l.label}
          </a>
        ))}
      </div>
    </div>
  );
}

/** «Сегодня в 15:30 (через 40 мин)», «завтра в 11:00», «пт, 14 ноября в 12:00» */
function when(iso: string, tz: string): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
  const diffMin = Math.round((+new Date(iso) - Date.now()) / 60_000);
  const t = fmtTime(iso, tz);
  if (day === dateInTz(tz, 0)) return diffMin <= 120 ? `сегодня в ${t} (через ${diffMin < 60 ? `${Math.max(diffMin, 1)} мин` : `${Math.floor(diffMin / 60)} ч ${diffMin % 60} мин`})` : `сегодня в ${t}`;
  if (day === dateInTz(tz, 1)) return `завтра в ${t}`;
  return `${new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', timeZone: tz }).format(new Date(iso))} в ${t}`;
}

/** Комплекс услуг: из чего состоит и сколько клиент экономит */
function ComboBadge({ s, all }: { s: Service; all: Service[] }) {
  if (!s.comboOf?.length) return null;
  const parts = all.filter((x) => s.comboOf!.includes(x.id));
  const save = parts.reduce((a, x) => a + x.price, 0) - s.price;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
      <span className="rounded-full bg-blush-300 px-2 py-0.5 font-semibold text-ink">Комплекс</span>
      {save > 0 && <span className="font-semibold text-[#0F7A52]">выгода {rub(save)}</span>}
    </p>
  );
}

const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
/** Витрина: депозит с бонусом и абонементы. Оформляются в салоне — деньги принимает салон. */
function Offers({ salon }: { salon: Salon }) {
  const l = salon.loyalty;
  if (!l || (!l.tiers.length && !l.plans.length)) return null;
  const rubles = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;
  return (
    <div className="flex snap-x gap-3 overflow-x-auto pb-1" aria-label="Абонементы и бонусы">
      {l.tiers.map((t) => (
        <div key={t.amount} className="min-w-[200px] snap-start rounded-2xl bg-blush-300 p-4 text-ink">
          <p className="text-xs font-semibold uppercase tracking-wide">Депозит</p>
          <p className="mt-1 text-lg font-bold">Внесите {rubles(t.amount)}</p>
          <p className="font-semibold">получите {rubles(t.amount + t.bonus)}</p>
        </div>
      ))}
      {l.plans.map((p) => {
        const rule = p.timeRule ? [p.timeRule.days?.length ? p.timeRule.days.map((d) => WD[d - 1]).join(', ') : '', p.timeRule.from || p.timeRule.to ? `${p.timeRule.from ?? ''}–${p.timeRule.to ?? ''}` : ''].filter(Boolean).join(' ') : '';
        return (
          <div key={p.name} className="min-w-[220px] snap-start rounded-2xl bg-white/[0.08] p-4 ring-1 ring-white/15">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#C9CCF2]">Абонемент</p>
            <p className="mt-1 font-semibold">{p.name}</p>
            <p className="text-sm text-[#C9CCF2]">{p.kind === 'VISITS' ? `${p.visits} визитов` : 'безлимит'} · {p.validityDays} дн.{rule ? ` · ${rule}` : ''}</p>
            {p.description && <p className="mt-1 text-sm text-[#E3E5F7]">{p.description}</p>}
            <p className="mt-2 text-lg font-bold">{rubles(p.price)}</p>
          </div>
        );
      })}
      <p className="sr-only">Оформить депозит или абонемент можно в салоне.</p>
    </div>
  );
}

type Work = { id: string; title: string | null; tags: string[]; master: string | null; service: string | null; width: number | null; height: number | null };
/** Портфолио: опубликованные салоном фото работ. Нажатие — крупно. */
function Portfolio({ slug }: { slug: string }) {
  const [works, setWorks] = useState<Work[]>([]);
  const [open, setOpen] = useState<Work | null>(null);
  useEffect(() => { api<Work[]>(`/public/${slug}/portfolio`).then(setWorks).catch(() => setWorks([])); }, [slug]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!works.length) return null;
  const src = (w: Work, size: 'thumb' | 'full') => `/v1/public/${slug}/portfolio/${w.id}/${size}`;
  return (
    <section className="space-y-3 pt-4">
      <h2 className="display text-2xl">Наши работы</h2>
      <div className="grid grid-cols-3 gap-1.5">
        {works.slice(0, 12).map((w) => (
          <button key={w.id} onClick={() => setOpen(w)} className="aspect-square overflow-hidden rounded-2xl bg-brand-50" aria-label={w.title ?? 'Фото работы'}>
            <img src={src(w, 'thumb')} alt={w.title ?? ''} loading="lazy" className="h-full w-full object-cover transition hover:scale-105" />
          </button>
        ))}
      </div>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={open.title ?? 'Фото работы'} className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ink/90 p-4" onClick={() => setOpen(null)}>
          <img src={src(open, 'full')} alt={open.title ?? ''} className="max-h-[75vh] max-w-full rounded-2xl object-contain" />
          <div className="mt-3 text-center text-white">
            {open.title && <p className="font-semibold">{open.title}</p>}
            <p className="text-sm text-[#C9CCF2]">{[open.service, open.master && `мастер ${open.master}`].filter(Boolean).join(' · ')}</p>
          </div>
          <button className="btn mt-4 bg-white text-ink" onClick={() => setOpen(null)}>Закрыть</button>
        </div>
      )}
    </section>
  );
}
