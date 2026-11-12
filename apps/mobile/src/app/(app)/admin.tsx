import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '../../components/Text';
import { Button, C, Card, Chip, ErrorText, Field, Muted, Screen } from '../../components/ui';
import { get, post } from '../../lib/api';
import { confirm } from '../../lib/confirm';
import { rub } from '../../lib/format';

type Overview = {
  version: string; subscriptions: Record<string, number>; signups: { days7: number; days30: number }; users: number;
  bookings: { day: number; days30: number; online30: number }; mrr: number;
  health: { workerAgeSec: number | null; errors24h: number; dbMb: number; disk: { freeGb: number; totalGb: number } | null };
};
type TenantRow = { id: string; name: string; slug: string; createdAt: string; masters: number; bookings30: number; owner: { email: string; name: string; lastLoginAt: string | null } | null; plan: string | null; status: string | null; until: string | null };
type ErrorRow = { id: string; at: string; source: string; path: string | null; message: string; stack: string | null; requestId: string | null };

const STATUS: Record<string, string> = { TRIAL: 'Пробный', ACTIVE: 'Оплачен', PAST_DUE: 'Просрочен', EXPIRED: 'Истёк', CANCELLED: 'Отменён' };
const dt = (s: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

/** Админ-панель владельца сервиса: здоровье, салоны, ошибки */
export default function Admin() {
  const [tab, setTab] = useState<'overview' | 'tenants' | 'errors'>('overview');
  return (
    <Screen>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip label="Обзор" active={tab === 'overview'} onPress={() => setTab('overview')} />
        <Chip label="Салоны" active={tab === 'tenants'} onPress={() => setTab('tenants')} />
        <Chip label="Ошибки" active={tab === 'errors'} onPress={() => setTab('errors')} />
      </View>
      {tab === 'overview' ? <OverviewTab /> : tab === 'tenants' ? <TenantsTab /> : <ErrorsTab />}
    </Screen>
  );
}

function Stat({ label, value, bad }: { label: string; value: string | number; bad?: boolean }) {
  return (
    <View style={{ flexBasis: '46%', flexGrow: 1, backgroundColor: bad ? '#FDECE7' : C.card, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: '#EEF0F7' }}>
      <Text style={{ fontSize: 13, color: C.muted }}>{label}</Text>
      <Text style={{ fontSize: 22, fontWeight: '800', color: bad ? '#9A2A08' : C.text }}>{value}</Text>
    </View>
  );
}

function OverviewTab() {
  const q = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => get<Overview>('/admin/overview'), refetchInterval: 30_000 });
  const reset = useMutation({ mutationFn: () => post('/admin/demo/reset') });
  const o = q.data;
  if (!o) return <ErrorText error={q.error} />;
  const workerBad = o.health.workerAgeSec === null || o.health.workerAgeSec > 300;
  const diskBad = !!o.health.disk && o.health.disk.freeGb / o.health.disk.totalGb < 0.1;
  return (
    <>
      <Text style={{ fontWeight: '700', color: C.text }}>Здоровье · версия {o.version}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Stat label="Воркер (напоминания)" value={workerBad ? 'не отвечает' : `ок, ${o.health.workerAgeSec} с`} bad={workerBad} />
        <Stat label="Ошибок за сутки" value={o.health.errors24h} bad={o.health.errors24h > 20} />
        <Stat label="База данных" value={`${o.health.dbMb} МБ`} />
        <Stat label="Свободно на диске" value={o.health.disk ? `${o.health.disk.freeGb} из ${o.health.disk.totalGb} ГБ` : '—'} bad={diskBad} />
      </View>
      <Text style={{ fontWeight: '700', color: C.text }}>Бизнес</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Stat label="Выручка в месяц (MRR)" value={rub(o.mrr)} />
        <Stat label="Оплачивают" value={o.subscriptions.ACTIVE ?? 0} />
        <Stat label="На пробном" value={o.subscriptions.TRIAL ?? 0} />
        <Stat label="Истёк / просрочен" value={(o.subscriptions.EXPIRED ?? 0) + (o.subscriptions.PAST_DUE ?? 0)} />
        <Stat label="Регистраций за 7 / 30 дн." value={`${o.signups.days7} / ${o.signups.days30}`} />
        <Stat label="Пользователей" value={o.users} />
        <Stat label="Записей за сутки" value={o.bookings.day} />
        <Stat label="Записей за 30 дн. (онлайн)" value={`${o.bookings.days30} (${o.bookings.online30})`} />
      </View>
      <Card>
        <Text style={{ fontWeight: '700', color: C.text }}>Если что-то сломалось</Text>
        <Muted>Команды для сервера — в файле docs/RUNBOOK.md: статус, логи, перезапуск, откат версии, бэкап и восстановление, перенос на новый сервер.</Muted>
        <Muted>Самое частое: перезапуск — «cd /opt/mioflow && sudo docker compose restart api worker», логи — «sudo docker compose logs --tail=200 api».</Muted>
      </Card>
      <Button title="Сбросить демо-салон сейчас" variant="ghost" loading={reset.isPending} onPress={async () => { if (await confirm('Сбросить демо?', 'Все изменения посетителей в демо-салоне будут удалены.', 'Сбросить')) reset.mutate(); }} />
      {reset.isSuccess && <Muted>Демо возвращено к исходному виду.</Muted>}
    </>
  );
}

function TenantsTab() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['admin', 'tenants', q], queryFn: () => get<TenantRow[]>(`/admin/tenants?q=${encodeURIComponent(q)}`) });
  const extend = useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) => post(`/admin/tenants/${id}/extend`, { days }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'tenants'] }),
  });
  return (
    <>
      <Field placeholder="Название, адрес страницы или email владельца" value={q} onChangeText={setQ} autoCapitalize="none" />
      <ErrorText error={list.error ?? extend.error} />
      {list.data?.map((t) => (
        <Card key={t.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ fontWeight: '700', color: C.text, flex: 1 }}>{t.name}</Text>
            <Text style={{ fontSize: 12, color: t.status === 'ACTIVE' ? '#0F6B48' : t.status === 'TRIAL' ? C.brand : '#9A2A08', fontWeight: '600' }}>{STATUS[t.status ?? ''] ?? t.status} · {t.plan}</Text>
          </View>
          <Muted>/b/{t.slug} · с {new Date(t.createdAt).toLocaleDateString('ru-RU')} · до {t.until ? new Date(t.until).toLocaleDateString('ru-RU') : '—'}</Muted>
          <Muted>{t.owner ? `${t.owner.name}, ${t.owner.email} · заходил ${dt(t.owner.lastLoginAt)}` : 'без владельца'}</Muted>
          <Muted>Мастеров: {t.masters} · записей за 30 дн.: {t.bookings30}</Muted>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            {[7, 30].map((d) => (
              <Pressable key={d} onPress={async () => { if (await confirm('Продлить?', `${t.name}: +${d} дней к ${t.status === 'TRIAL' ? 'пробному периоду' : 'оплаченному сроку'}`, 'Продлить')) extend.mutate({ id: t.id, days: d }); }}
                style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: C.border }}>
                <Text style={{ color: C.text, fontWeight: '600' }}>+{d} дней</Text>
              </Pressable>
            ))}
          </View>
        </Card>
      ))}
    </>
  );
}

function ErrorsTab() {
  const list = useQuery({ queryKey: ['admin', 'errors'], queryFn: () => get<ErrorRow[]>('/admin/errors?limit=100'), refetchInterval: 30_000 });
  const [open, setOpen] = useState<string | null>(null);
  if (list.data?.length === 0) return <Muted>Ошибок за последние 30 дней нет 🎉</Muted>;
  return (
    <>
      <ErrorText error={list.error} />
      {list.data?.map((e) => (
        <Pressable key={e.id} onPress={() => setOpen(open === e.id ? null : e.id)}>
          <Card>
            <Muted>{dt(e.at)} · {e.source === 'api' ? 'API' : 'воркер'}{e.path ? ` · ${e.path}` : ''}</Muted>
            <Text style={{ color: C.text }} numberOfLines={open === e.id ? undefined : 2}>{e.message}</Text>
            {open === e.id && e.stack && <Text selectable style={{ fontSize: 11, color: C.muted }}>{e.stack}</Text>}
            {open === e.id && e.requestId && <Muted>Запрос: {e.requestId} (ищите в логах: docker compose logs api | grep {e.requestId})</Muted>}
          </Card>
        </Pressable>
      ))}
    </>
  );
}
