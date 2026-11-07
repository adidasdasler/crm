import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { api, APP_URL, rub } from '../lib/api';

/** Тестовая «оплата» (PAYMENT_PROVIDER=mock): только для разработки, в production API её не отдаёт. */
export function MockPay() {
  const { id = '' } = useParams();
  const [p, setP] = useState<{ amount: number; status: string; billingPeriod: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<typeof p>(`/billing/mock/${id}`).then(setP).catch((e) => setErr(e.message)); }, [id]);

  async function pay() {
    await api(`/billing/mock/${id}/succeed`, { method: 'POST' });
    window.location.href = `${APP_URL}/billing?payment=${id}`;
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="card space-y-4 p-6 text-center">
        <p className="rounded-xl bg-amber-50 p-2 text-sm text-amber-800">Тестовый режим — деньги не списываются</p>
        {err && <p className="text-red-600">{err}</p>}
        {p && (
          <>
            <p className="text-ink-muted">Оплата подписки MioFlow · {p.billingPeriod === 'YEARLY' ? '12 месяцев' : '1 месяц'}</p>
            <p className="text-4xl font-bold">{rub(p.amount)}</p>
            {p.status === 'PENDING' ? <button className="btn-primary w-full" onClick={pay}>Оплатить</button> : <p>Статус: {p.status}</p>}
          </>
        )}
      </div>
    </div>
  );
}
