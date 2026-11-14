import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Logo } from '../Logo';
import { api, ApiError } from '../lib/api';
import { oauthUrl } from '../lib/client';

/** Кабинет клиента: вход, регистрация, восстановление пароля, подтверждение email */
function Frame({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  useEffect(() => { document.title = `${title} — MioFlow`; }, [title]);
  return (
    <div className="grid min-h-screen place-items-center bg-[#F6F7FB] px-4 py-10">
      <div className="w-full max-w-sm space-y-5">
        <Link to="/" aria-label="На главную"><Logo size={28} /></Link>
        <div className="card space-y-4">
          <div>
            <h1 className="display text-2xl">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
          </div>
          {children}
        </div>
        <p className="text-center text-xs text-ink-muted">Это кабинет для клиентов салонов. Салоны и мастера входят в приложение на <a className="underline" href="https://app.mioflow.ru">app.mioflow.ru</a></p>
      </div>
    </div>
  );
}

const Err = ({ text }: { text: string | null }) => (text ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{text}</p> : null);

function Consent({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 text-sm text-ink-muted">
      <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-600" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>Даю <Link className="text-brand-600 underline" to="/account/consent" target="_blank">согласие на обработку персональных данных</Link> для кабинета</span>
    </label>
  );
}

/** Кнопка Яндекс ID — если вход подключён на сервере */
function OAuth({ consent, needConsent }: { consent: boolean; needConsent: boolean }) {
  const [providers, setProviders] = useState<string[]>([]);
  useEffect(() => { api<{ providers: string[] }>('/client/config').then((r) => setProviders(r.providers)).catch(() => null); }, []);
  if (!providers.length) return null;
  const off = needConsent && !consent;
  const cls = `flex w-full items-center justify-center gap-2 rounded-full py-3 font-semibold ${off ? 'pointer-events-none opacity-40' : ''}`;
  return (
    <div className="space-y-2">
      {providers.includes('yandex') && <a className={`${cls} bg-[#FC3F1D] text-white`} href={oauthUrl('yandex', consent)}>Войти с Яндекс ID</a>}
      {off && <p className="text-center text-xs text-ink-muted">Отметьте согласие ниже, чтобы войти впервые</p>}
      <div className="flex items-center gap-3 py-1 text-xs text-ink-muted"><span className="h-px flex-1 bg-brand-50" />или по email<span className="h-px flex-1 bg-brand-50" /></div>
    </div>
  );
}

export function AccountLogin() {
  const nav = useNavigate();
  const [q] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(q.get('error'));
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api('/client/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      nav('/my');
    } catch (x) { setErr((x as ApiError).message); } finally { setBusy(false); }
  }
  return (
    <Frame title="Вход в кабинет" subtitle="Ваши записи во всех салонах на MioFlow — на любом устройстве">
      <OAuth consent={consent} needConsent={false} />
      <form onSubmit={submit} className="space-y-3">
        <input className="input" type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <input className="input" type="password" required placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <Err text={err} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Входим…' : 'Войти'}</button>
      </form>
      <Consent value={consent} onChange={setConsent} />
      <p className="-mt-2 text-xs text-ink-muted">Согласие нужно один раз — при первом входе через Яндекс ID.</p>
      <div className="flex justify-between text-sm">
        <Link className="text-ink-muted hover:underline" to="/account/forgot">Забыли пароль?</Link>
        <Link className="font-semibold text-brand-600" to="/account/register">Регистрация</Link>
      </div>
    </Frame>
  );
}

export function AccountRegister() {
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api('/client/register', { method: 'POST', body: JSON.stringify({ ...f, consent }) });
      nav('/my?welcome=1');
    } catch (x) { setErr((x as ApiError).message); } finally { setBusy(false); }
  }
  return (
    <Frame title="Регистрация" subtitle="Кабинет бесплатный. Все записи — в одном месте, на телефоне и компьютере">
      <OAuth consent={consent} needConsent />
      <form onSubmit={submit} className="space-y-3">
        <input className="input" required placeholder="Как вас зовут" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" />
        <input className="input" type="email" required placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" />
        <input className="input" type="password" required minLength={8} placeholder="Пароль, от 8 символов" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
        <Consent value={consent} onChange={setConsent} />
        <Err text={err} />
        <button className="btn-primary w-full" disabled={busy || !consent}>{busy ? 'Создаём…' : 'Создать кабинет'}</button>
      </form>
      <p className="text-center text-sm">Уже есть кабинет? <Link className="font-semibold text-brand-600" to="/account/login">Войти</Link></p>
    </Frame>
  );
}

export function AccountForgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try { await api('/client/forgot', { method: 'POST', body: JSON.stringify({ email }) }); setSent(true); } catch (x) { setErr((x as ApiError).message); }
  }
  return (
    <Frame title="Восстановление пароля" subtitle="Пришлём ссылку для нового пароля. Подойдёт и для тех, кто входил через Яндекс или VK — так можно задать пароль">
      {sent ? (
        <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">Если такой email есть в MioFlow, письмо уже в пути. Проверьте папку «Спам», если его нет в течение пары минут.</p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <input className="input" type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <Err text={err} />
          <button className="btn-primary w-full">Прислать ссылку</button>
        </form>
      )}
      <Link className="block text-center text-sm text-brand-600" to="/account/login">Вернуться ко входу</Link>
    </Frame>
  );
}

export function AccountReset() {
  const nav = useNavigate();
  const [q] = useSearchParams();
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api('/client/reset', { method: 'POST', body: JSON.stringify({ token: q.get('token') ?? '', password }) });
      nav('/my');
    } catch (x) { setErr((x as ApiError).message); }
  }
  return (
    <Frame title="Новый пароль" subtitle="После смены пароля на других устройствах нужно будет войти заново">
      <form onSubmit={submit} className="space-y-3">
        <input className="input" type="password" required minLength={8} placeholder="Новый пароль, от 8 символов" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        <Err text={err} />
        <button className="btn-primary w-full">Сохранить и войти</button>
      </form>
    </Frame>
  );
}

export function AccountVerify() {
  const [q] = useSearchParams();
  const [state, setState] = useState<'wait' | 'ok' | string>('wait');
  useEffect(() => {
    api('/client/verify', { method: 'POST', body: JSON.stringify({ token: q.get('token') ?? '' }) })
      .then(() => setState('ok')).catch((x: ApiError) => setState(x.message));
  }, [q]);
  return (
    <Frame title="Подтверждение email">
      {state === 'wait' ? <p className="text-ink-muted">Проверяем…</p> : state === 'ok' ? (
        <>
          <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">Email подтверждён. Теперь в кабинете видны и записи, которые салоны сделали на этот email.</p>
          <Link className="btn-primary w-full" to="/my">Мои записи</Link>
        </>
      ) : <Err text={state} />}
    </Frame>
  );
}
