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
type TenantRow = { id: string; name: string; slug: string; createdAt: string; masters: number; bookings30: number; owner: { email: string; name: string; lastLoginAt: string | null } | null; plan: string | null; status: string | null; until: string | null };
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
  const { data, err, reload } = useLoad<TenantRow[]>(`/admin/tenants?q=${encodeURIComponent(query)}`);
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
      <input className="input max-w-md" placeholder="Поиск: название, адрес страницы, email владельца" value={q} onChange={(e) => setQ(e.target.value)} />
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
                <td className="p-3"><a className="font-semibold hover:underline" href={`/b/${t.slug}`} target="_blank" rel="noreferrer">{t.name}</a><div className="text-xs text-ink-muted">с {d(t.createdAt)}</div></td>
                <td className="p-3">{t.owner ? <>{t.owner.email}<div className="text-xs text-ink-muted">заходил {dt(t.owner.lastLoginAt)}</div></> : '—'}</td>
                <td className="p-3"><span className={t.status === 'ACTIVE' ? 'text-emerald-700' : t.status === 'TRIAL' ? 'text-brand-600' : 'text-red-700'}>{STATUS[t.status ?? ''] ?? t.status}</span><div className="text-xs text-ink-muted">{t.plan}</div></td>
                <td className="p-3">{d(t.until)}</td>
                <td className="p-3">{t.masters}</td>
                <td className="p-3">{t.bookings30}</td>
                <td className="whitespace-nowrap p-3 text-right">
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
