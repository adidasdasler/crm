import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Mark } from '../Logo';
import { api, ApiError, rub } from '../lib/api';

/**
 * Панель владельца сервиса MioFlow: mioflow.ru/admin.
 * Отдельный вход (email + пароль + код из приложения-аутентификатора), не связан с аккаунтами салонов.
 */
type Overview = {
  version: string; subscriptions: Record<string, number>; signups: { days7: number; days30: number }; users: number;
  bookings: { day: number; days30: number; online30: number }; mrr: number;
  health: { workerAgeSec: number | null; errors24h: number; dbMb: number; disk: { freeGb: number; totalGb: number } | null };
};
type TenantRow = { id: string; name: string; slug: string; createdAt: string; blocked?: boolean; deletedAt?: string | null; masters: number; bookings30: number; owner: { email: string; name: string; lastLoginAt: string | null } | null; plan: string | null; status: string | null; until: string | null };
type ErrorRow = { id: string; at: string; source: string; path: string | null; message: string; stack: string | null; requestId: string | null };
type Task = { id: string; kind: string; title: string; status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED'; output: string | null; requestedBy: string; createdAt: string; finishedAt: string | null };
type Tasks = { kinds: Record<string, string>; agentAgeSec: number | null; tasks: Task[] };

const STATUS: Record<string, string> = { TRIAL: 'Пробный', ACTIVE: 'Оплачен', PAST_DUE: 'Просрочен', EXPIRED: 'Истёк', CANCELLED: 'Отменён' };
const dt = (s: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const d = (s: string | null) => (s ? new Date(s).toLocaleDateString('ru-RU') : '—');
type Tab = 'overview' | 'tenants' | 'server' | 'errors';

export function AdminPage() {
  const [me, setMe] = useState<string | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('overview');
  useEffect(() => {
    document.title = 'Панель MioFlow';
    const m = document.createElement('meta');
    m.name = 'robots'; m.content = 'noindex, nofollow';
    document.head.appendChild(m);
    api<{ email: string }>('/admin/me').then((r) => setMe(r.email)).catch(() => setMe(null));
    return () => m.remove();
  }, []);

  if (me === undefined) return <div className="grid min-h-screen place-items-center text-ink-muted">Загрузка…</div>;
  if (me === null) return <Login onDone={setMe} />;

  const tabs: [Tab, string][] = [['overview', 'Обзор'], ['tenants', 'Салоны'], ['server', 'Сервер'], ['errors', 'Ошибки']];
  return (
    <div className="min-h-screen bg-[#F6F7FB]">
      <header className="sticky top-0 z-10 border-b border-brand-50 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-2 font-semibold"><Mark size={24} /> Панель MioFlow</div>
          <nav className="flex flex-1 gap-1 overflow-x-auto">
            {tabs.map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold ${tab === k ? 'bg-ink text-white' : 'text-ink-muted hover:bg-brand-50'}`}>{l}</button>
            ))}
          </nav>
          <span className="hidden text-sm text-ink-muted sm:inline">{me}</span>
          <button className="text-sm font-semibold text-brand-600" onClick={() => api('/admin/auth/logout', { method: 'POST' }).finally(() => setMe(null))}>Выйти</button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        {tab === 'overview' && <OverviewTab />}
        {tab === 'tenants' && <TenantsTab />}
        {tab === 'server' && <ServerTab />}
        {tab === 'errors' && <ErrorsTab />}
      </main>
    </div>
  );
}

function Login({ onDone }: { onDone: (email: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      onDone((await api<{ email: string }>('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email, password, code }) })).email);
    } catch (x) {
      setErr((x as ApiError).message);
      setCode('');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid min-h-screen place-items-center bg-[#F6F7FB] px-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
        <div className="flex items-center gap-2 text-lg font-semibold"><Mark size={28} /> Панель MioFlow</div>
        <p className="text-sm text-ink-muted">Для владельца сервиса. Салоны и мастера входят в своё приложение на app.mioflow.ru.</p>
        <input className="input" type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        <input className="input" type="password" required placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <input className="input tracking-[0.3em]" required inputMode="numeric" maxLength={6} placeholder="Код из приложения" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code" />
        {err && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{err}</p>}
        <button className="btn-primary w-full" disabled={busy || code.length !== 6}>{busy ? 'Входим…' : 'Войти'}</button>
      </form>
    </div>
  );
}

function useLoad<T>(path: string, every?: number) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api<T>(path).then((r) => { setData(r); setErr(null); }).catch((e: ApiError) => setErr(e.message)), [path]);
  useEffect(() => {
    void load();
    if (!every) return;
    const t = setInterval(load, every);
    return () => clearInterval(t);
  }, [load, every]);
  return { data, err, reload: load };
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'bad' | 'good' }) {
  return (
    <div className={`rounded-2xl p-4 ring-1 ${tone === 'bad' ? 'bg-red-50 ring-red-100' : 'bg-white ring-brand-50'}`}>
      <p className="text-sm text-ink-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone === 'bad' ? 'text-red-700' : tone === 'good' ? 'text-emerald-700' : ''}`}>{value}</p>
    </div>
  );
}

function OverviewTab() {
  const { data: o, err } = useLoad<Overview>('/admin/overview', 30_000);
  if (err) return <p className="text-red-700">{err}</p>;
  if (!o) return <p className="text-ink-muted">Загрузка…</p>;
  const workerBad = o.health.workerAgeSec === null || o.health.workerAgeSec > 300;
  const diskBad = !!o.health.disk && o.health.disk.freeGb / o.health.disk.totalGb < 0.1;
  return (
    <>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Здоровье сервера <span className="text-sm font-normal text-ink-muted">· версия {o.version.slice(0, 12)}</span></h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Напоминания и фоновые задачи" value={workerBad ? 'не работают' : 'работают'} tone={workerBad ? 'bad' : 'good'} />
          <Stat label="Ошибок за сутки" value={o.health.errors24h} tone={o.health.errors24h > 20 ? 'bad' : undefined} />
          <Stat label="База данных" value={`${o.health.dbMb} МБ`} />
          <Stat label="Свободно на диске" value={o.health.disk ? `${o.health.disk.freeGb} из ${o.health.disk.totalGb} ГБ` : '—'} tone={diskBad ? 'bad' : undefined} />
        </div>
        {workerBad && <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-800">Напоминания не уходят. Откройте «Сервер» и нажмите «Перезапустить API и воркер», затем посмотрите «Последние логи воркера».</p>}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Бизнес</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Выручка в месяц (MRR)" value={rub(o.mrr)} />
          <Stat label="Платящих салонов" value={o.subscriptions.ACTIVE ?? 0} />
          <Stat label="На пробном периоде" value={o.subscriptions.TRIAL ?? 0} />
          <Stat label="Истёк или просрочен" value={(o.subscriptions.EXPIRED ?? 0) + (o.subscriptions.PAST_DUE ?? 0)} />
          <Stat label="Регистраций за 7 дней" value={o.signups.days7} />
          <Stat label="Регистраций за 30 дней" value={o.signups.days30} />
          <Stat label="Записей за сутки" value={o.bookings.day} />
          <Stat label="Записей за 30 дней, из них онлайн" value={`${o.bookings.days30} / ${o.bookings.online30}`} />
        </div>
      </section>
    </>
  );
}

function TenantsTab() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => { const t = setTimeout(() => setQuery(q), 300); return () => clearTimeout(t); }, [q]);
  const [deleted, setDeleted] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, err, reload } = useLoad<TenantRow[]>(`/admin/tenants?q=${encodeURIComponent(query)}${deleted ? '&deleted=1' : ''}`);
  const [msg, setMsg] = useState<string | null>(null);
  async function extend(t: TenantRow, days: number) {
    if (!confirm(`${t.name}: продлить ${t.status === 'TRIAL' ? 'пробный период' : 'оплаченный срок'} на ${days} дней?`)) return;
    try {
      await api(`/admin/tenants/${t.id}/extend`, { method: 'POST', body: JSON.stringify({ days }) });
      setMsg(`${t.name}: продлено на ${days} дней`);
      void reload();
    } catch (e) {
      setMsg((e as ApiError).message);
    }
  }
  return (
    <section className="space-y-3">
      {openId && <TenantCard id={openId} onClose={() => { setOpenId(null); void reload(); }} />}
      <div className="flex flex-wrap items-center gap-3">
        <input className="input max-w-md" placeholder="Поиск: название, адрес страницы, email владельца" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-ink-muted"><input type="checkbox" checked={deleted} onChange={(e) => setDeleted(e.target.checked)} /> Удалённые (можно восстановить 30 дней)</label>
      </div>
      {msg && <p className="text-sm text-emerald-700">{msg}</p>}
      {err && <p className="text-red-700">{err}</p>}
      <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-brand-50">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="text-ink-muted"><tr className="border-b border-brand-50">
            <th className="p-3">Салон</th><th className="p-3">Владелец</th><th className="p-3">Тариф</th><th className="p-3">До</th><th className="p-3">Мастеров</th><th className="p-3">Записей 30 дн.</th><th className="p-3" />
          </tr></thead>
          <tbody>
            {data?.map((t) => (
              <tr key={t.id} className="border-b border-brand-50 last:border-0">
                <td className="p-3">
                  <button className="text-left font-semibold hover:underline" onClick={() => setOpenId(t.id)}>{t.name}</button>
                  {t.blocked && <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">заблокирован</span>}
                  {t.deletedAt && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">удалён {d(t.deletedAt)}</span>}
                  <div className="text-xs text-ink-muted">/b/{t.slug} · с {d(t.createdAt)}</div>
                </td>
                <td className="p-3">{t.owner ? <>{t.owner.email}<div className="text-xs text-ink-muted">заходил {dt(t.owner.lastLoginAt)}</div></> : '—'}</td>
                <td className="p-3"><span className={t.status === 'ACTIVE' ? 'text-emerald-700' : t.status === 'TRIAL' ? 'text-brand-600' : 'text-red-700'}>{STATUS[t.status ?? ''] ?? t.status}</span><div className="text-xs text-ink-muted">{t.plan}</div></td>
                <td className="p-3">{d(t.until)}</td>
                <td className="p-3">{t.masters}</td>
                <td className="p-3">{t.bookings30}</td>
                <td className="whitespace-nowrap p-3 text-right">
                  <button className="mr-2 font-semibold text-brand-600" onClick={() => setOpenId(t.id)}>Открыть</button>
                  <button className="mr-2 rounded-full px-3 py-1 ring-1 ring-brand-100 hover:bg-brand-50" onClick={() => extend(t, 7)}>+7 дн.</button>
                  <button className="rounded-full px-3 py-1 ring-1 ring-brand-100 hover:bg-brand-50" onClick={() => extend(t, 30)}>+30 дн.</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.length === 0 && <p className="p-4 text-ink-muted">Ничего не нашлось</p>}
      </div>
    </section>
  );
}

function ServerTab() {
  const { data, err, reload } = useLoad<Tasks>('/admin/tasks', 5_000);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  async function run(kind: string, title: string) {
    const danger = ['restart', 'deploy'].includes(kind);
    if (danger && !confirm(`${title}? Сайт может быть недоступен ${kind === 'deploy' ? 'несколько минут' : 'около 30 секунд'}.`)) return;
    try {
      const t = await api<Task>('/admin/tasks', { method: 'POST', body: JSON.stringify({ kind }) });
      setOpen(t.id);
      setMsg('Задача поставлена — сервер выполнит её в течение минуты');
      void reload();
    } catch (e) {
      setMsg((e as ApiError).message);
    }
  }
  if (err) return <p className="text-red-700">{err}</p>;
  if (!data) return <p className="text-ink-muted">Загрузка…</p>;
  const agentBad = data.agentAgeSec === null || data.agentAgeSec > 180;
  const tone = (s: Task['status']) => (s === 'DONE' ? 'text-emerald-700' : s === 'FAILED' ? 'text-red-700' : 'text-brand-600');
  const label = { PENDING: 'в очереди', RUNNING: 'выполняется…', DONE: 'готово', FAILED: 'ошибка' };
  return (
    <>
      {agentBad && (
        <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
          Исполнитель задач на сервере не отвечает{data.agentAgeSec !== null ? ` (последний раз ${Math.round(data.agentAgeSec / 60)} мин назад)` : ''} — кнопки не сработают.
          Он включается при обновлении: <code className="rounded bg-white px-1">cd /opt/mioflow && sudo bash deploy/scripts/deploy.sh</code>
        </p>
      )}
      <section className="grid gap-3 md:grid-cols-2">
        <div className="card space-y-2">
          <h3 className="font-semibold">Посмотреть</h3>
          {(['status', 'logs_api', 'logs_worker'] as const).map((k) => <button key={k} className="btn-ghost w-full justify-start" onClick={() => run(k, data.kinds[k])}>{data.kinds[k]}</button>)}
        </div>
        <div className="card space-y-2">
          <h3 className="font-semibold">Действия</h3>
          {(['restart', 'backup', 'test_restore', 'deploy'] as const).map((k) => <button key={k} className="btn-ghost w-full justify-start" onClick={() => run(k, data.kinds[k])}>{data.kinds[k]}</button>)}
        </div>
      </section>
      {msg && <p className="text-sm text-ink-muted">{msg}</p>}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">История</h2>
        {data.tasks.length === 0 && <p className="text-ink-muted">Задач ещё не было</p>}
        {data.tasks.map((t) => (
          <div key={t.id} className="rounded-2xl bg-white ring-1 ring-brand-50">
            <button className="flex w-full items-center justify-between gap-3 p-4 text-left" onClick={() => setOpen(open === t.id ? null : t.id)}>
              <span><b>{t.title}</b> <span className="text-sm text-ink-muted">· {dt(t.createdAt)} · {t.requestedBy}</span></span>
              <span className={`text-sm font-semibold ${tone(t.status)}`}>{label[t.status]}</span>
            </button>
            {open === t.id && (
              <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap border-t border-brand-50 bg-[#0F1222] p-4 text-xs text-[#E3E5F7]">{t.output ?? (t.status === 'PENDING' ? 'Ждём, когда сервер заберёт задачу (до минуты)…' : 'Выполняется…')}</pre>
            )}
          </div>
        ))}
      </section>
      <section className="card space-y-2 text-sm text-ink-muted">
        <h3 className="font-semibold text-ink">Восстановление из бэкапа и перенос на другой сервер</h3>
        <p>Эти действия заменяют все данные, поэтому выполняются только вручную по SSH: <code className="rounded bg-brand-50 px-1">sudo bash deploy/scripts/restore.sh</code>. Пошагово — в docs/RUNBOOK.md, разделы 6 и 7.</p>
      </section>
    </>
  );
}

function ErrorsTab() {
  const { data, err } = useLoad<ErrorRow[]>('/admin/errors?limit=100', 30_000);
  const [open, setOpen] = useState<string | null>(null);
  if (err) return <p className="text-red-700">{err}</p>;
  if (!data) return <p className="text-ink-muted">Загрузка…</p>;
  if (!data.length) return <p className="text-ink-muted">Ошибок за последние 30 дней нет.</p>;
  return (
    <section className="space-y-2">
      {data.map((e) => (
        <div key={e.id} className="rounded-2xl bg-white ring-1 ring-brand-50">
          <button className="w-full p-4 text-left" onClick={() => setOpen(open === e.id ? null : e.id)}>
            <p className="text-xs text-ink-muted">{dt(e.at)} · {e.source === 'api' ? 'API' : 'воркер'}{e.path ? ` · ${e.path}` : ''}</p>
            <p className={open === e.id ? '' : 'line-clamp-2'}>{e.message}</p>
          </button>
          {open === e.id && (
            <div className="space-y-2 border-t border-brand-50 p-4 text-xs">
              {e.requestId && <p className="text-ink-muted">Запрос {e.requestId}. В логах: <code>sudo docker compose logs api | grep {e.requestId}</code></p>}
              {e.stack && <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-[#0F1222] p-3 text-[#E3E5F7]">{e.stack}</pre>}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

type Card = {
  id: string; name: string; slug: string; createdAt: string; blockedAt: string | null; blockReason: string | null;
  deletedAt: string | null; canRestore: boolean; restoreUntil: string | null;
  owner: { email: string; name: string; lastLoginAt: string | null; twoFactor: boolean; deleted: boolean } | null;
  subscription: { status: string; plan: { code: string; name: string }; trialEndsAt: string | null; currentPeriodEnd: string | null } | null;
  counts: { masters: number; staff: number; customers: number; bookings30: number };
  plans: { code: string; name: string }[];
  history: { action: string; createdAt: string; after: Record<string, unknown> | null }[];
};
type Action = { title: string; danger?: boolean; path: string; fields?: { key: string; label: string; placeholder?: string; initial?: string }[]; extra?: Record<string, unknown>; note?: string };

const ACTIONS: Record<string, string> = {
  'admin.block': 'Заблокирован', 'admin.unblock': 'Разблокирован', 'admin.delete': 'Удалён', 'admin.restore': 'Восстановлен',
  'admin.edit': 'Изменены данные', 'admin.extend': 'Продлён срок', 'admin.owner_email': 'Сменён email владельца',
  'admin.owner_reset_password': 'Отправлена ссылка сброса пароля', 'admin.owner_disable_2fa': 'Выключен вход с кодом',
};

/** Карточка салона с действиями поддержки. Каждое действие — с паролем и кодом */
function TenantCard({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: c, err, reload } = useLoad<Card>(`/admin/tenants/${id}`);
  const [action, setAction] = useState<Action | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const until = c?.subscription ? (c.subscription.status === 'TRIAL' ? c.subscription.trialEndsAt : c.subscription.currentPeriodEnd) : null;
  const btn = 'rounded-full px-4 py-2 text-sm font-semibold ring-1 ring-brand-100 hover:bg-brand-50';
  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="h-full w-full max-w-xl space-y-5 overflow-y-auto bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">{c?.name ?? 'Салон'}</h2>
            {c && <a className="text-sm text-brand-600 hover:underline" href={`/b/${c.slug}`} target="_blank" rel="noreferrer">mioflow.ru/b/{c.slug}</a>}
          </div>
          <button className="text-2xl leading-none text-ink-muted" onClick={onClose} aria-label="Закрыть">×</button>
        </div>
        {err && <p className="text-red-700">{err}</p>}
        {done && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{done}</p>}
        {c && (
          <>
            {c.blockedAt && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">Заблокирован {dt(c.blockedAt)}: {c.blockReason}</p>}
            {c.deletedAt && <p className="rounded-xl bg-slate-100 p-3 text-sm">Удалён {dt(c.deletedAt)}. {c.canRestore ? `Можно восстановить до ${d(c.restoreUntil)}.` : 'Восстановить уже нельзя.'}</p>}
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-ink-muted">Владелец</dt><dd>{c.owner ? <>{c.owner.name}<br />{c.owner.email}</> : '—'}</dd></div>
              <div><dt className="text-ink-muted">Последний вход</dt><dd>{dt(c.owner?.lastLoginAt ?? null)}{c.owner?.twoFactor ? ' · вход с кодом' : ''}</dd></div>
              <div><dt className="text-ink-muted">Тариф</dt><dd>{c.subscription ? `${c.subscription.plan.name} · ${STATUS[c.subscription.status] ?? c.subscription.status}` : '—'}</dd></div>
              <div><dt className="text-ink-muted">До</dt><dd>{d(until)}</dd></div>
              <div><dt className="text-ink-muted">Мастеров / сотрудников</dt><dd>{c.counts.masters} / {c.counts.staff}</dd></div>
              <div><dt className="text-ink-muted">Клиентов · записей за 30 дн.</dt><dd>{c.counts.customers} · {c.counts.bookings30}</dd></div>
            </dl>

            {!c.deletedAt && (
              <>
                <section className="space-y-2">
                  <h3 className="font-semibold">Данные салона</h3>
                  <div className="flex flex-wrap gap-2">
                    <button className={btn} onClick={() => setAction({ title: 'Изменить название и адрес страницы', path: 'edit', fields: [{ key: 'name', label: 'Название', initial: c.name }, { key: 'slug', label: 'Адрес страницы (mioflow.ru/b/…)', initial: c.slug }] })}>Название и адрес</button>
                    <button className={btn} onClick={() => setAction({ title: 'Сменить тариф', path: 'edit', fields: [{ key: 'planCode', label: `Код тарифа: ${c.plans.map((p) => `${p.code} — ${p.name}`).join(', ')}`, initial: c.subscription?.plan.code }] })}>Тариф</button>
                  </div>
                </section>
                <section className="space-y-2">
                  <h3 className="font-semibold">Доступ владельца</h3>
                  <div className="flex flex-wrap gap-2">
                    <button className={btn} onClick={() => setAction({ title: 'Отправить владельцу ссылку для нового пароля', path: 'owner', extra: { action: 'reset-password' }, note: `Письмо уйдёт на ${c.owner?.email}. Вы ссылку не увидите.` })}>Сброс пароля</button>
                    <button className={btn} onClick={() => setAction({ title: 'Сменить email владельца', path: 'owner', extra: { action: 'email' }, fields: [{ key: 'email', label: 'Новый email', placeholder: 'new@mail.ru' }], note: 'Только если владелец подтвердил личность другим способом (например, звонком). Все его сессии завершатся.' })}>Сменить email</button>
                    {c.owner?.twoFactor && <button className={btn} onClick={() => setAction({ title: 'Выключить владельцу вход с кодом', path: 'owner', extra: { action: 'disable-2fa' }, note: 'Если владелец потерял телефон и не может войти.' })}>Выключить вход с кодом</button>}
                  </div>
                </section>
              </>
            )}

            <section className="space-y-2 rounded-2xl bg-red-50/60 p-4">
              <h3 className="font-semibold text-red-800">Опасные действия</h3>
              <div className="flex flex-wrap gap-2">
                {!c.deletedAt && (c.blockedAt
                  ? <button className={btn} onClick={() => setAction({ title: 'Разблокировать салон', path: 'unblock' })}>Разблокировать</button>
                  : <button className={`${btn} text-red-700`} onClick={() => setAction({ title: 'Заблокировать салон', danger: true, path: 'block', fields: [{ key: 'reason', label: 'Причина (увидит владелец)', placeholder: 'Жалобы клиентов на мошенничество' }], note: 'Сотрудники не смогут войти, онлайн-запись закроется. Данные сохранятся.' })}>Заблокировать</button>)}
                {!c.deletedAt && <button className={`${btn} text-red-700`} onClick={() => setAction({ title: 'Удалить салон', danger: true, path: 'delete', fields: [{ key: 'confirmName', label: `Впишите название: ${c.name}` }, { key: 'reason', label: 'Причина (увидит владелец)', placeholder: 'По просьбе владельца' }], note: 'Салон сразу закроется. Данные сотрутся окончательно через 30 дней, до этого салон можно восстановить.' })}>Удалить</button>}
                {c.canRestore && <button className={btn} onClick={() => setAction({ title: 'Восстановить салон', path: 'restore', note: 'Вернутся данные, сотрудники и адрес страницы (если его не занял другой салон).' })}>Восстановить</button>}
              </div>
            </section>

            <section className="space-y-1 text-sm">
              <h3 className="font-semibold">Журнал действий поддержки</h3>
              {c.history.length === 0 && <p className="text-ink-muted">Пока не было</p>}
              {c.history.map((h, i) => (
                <p key={i} className="text-ink-muted">{dt(h.createdAt)} · <span className="text-ink">{ACTIONS[h.action] ?? h.action}</span>{h.after?.by ? ` · ${String(h.after.by)}` : ''}{h.after?.reason ? ` · ${String(h.after.reason)}` : ''}</p>
              ))}
            </section>
          </>
        )}
        {action && c && (
          <ConfirmAction id={c.id} action={action} onClose={() => setAction(null)} onDone={(msg) => { setAction(null); setDone(msg); void reload(); }} />
        )}
      </aside>
    </div>
  );
}

/** Подтверждение действия: поля + пароль + код из приложения */
function ConfirmAction({ id, action, onClose, onDone }: { id: string; action: Action; onClose: () => void; onDone: (msg: string) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries((action.fields ?? []).map((f) => [f.key, f.initial ?? ''])));
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body = { ...action.extra, ...Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim())), password, code };
      await api(`/admin/tenants/${id}/${action.path}`, { method: 'POST', body: JSON.stringify(body) });
      onDone(`Готово: ${action.title.toLowerCase()}`);
    } catch (x) {
      setErr((x as ApiError).message);
      setCode('');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/40 px-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="card w-full max-w-md space-y-3">
        <h3 className="text-lg font-bold">{action.title}</h3>
        {action.note && <p className="text-sm text-ink-muted">{action.note}</p>}
        {action.fields?.map((f) => (
          <label key={f.key} className="block space-y-1 text-sm">
            <span className="text-ink-muted">{f.label}</span>
            <input className="input" required value={values[f.key] ?? ''} placeholder={f.placeholder} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
          </label>
        ))}
        <p className="pt-2 text-sm font-semibold">Подтвердите, что это вы</p>
        <input className="input" type="password" required placeholder="Пароль от панели" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <input className="input tracking-[0.3em]" required inputMode="numeric" maxLength={6} placeholder="Код из приложения" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code" />
        {err && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{err}</p>}
        <div className="flex gap-2">
          <button className={`btn-primary flex-1 ${action.danger ? '!bg-red-600' : ''}`} disabled={busy || code.length !== 6}>{busy ? 'Выполняем…' : 'Подтвердить'}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>Отмена</button>
        </div>
      </form>
    </div>
  );
}
