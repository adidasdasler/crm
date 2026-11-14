import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { get, post } from '../lib/api';
import { can, useMe } from '../lib/auth';
import type { Account, PassPlan } from '../lib/types';
import { Text } from './Text';
import { Button, C, Card, Chip, ErrorText, Field, Muted } from './ui';

const rubles = (n: number) => `${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
const num = (s: string) => parseFloat(s.replace(',', '.').replace(/\s/g, ''));
const METHODS = [{ key: 'card', label: 'Карта' }, { key: 'cash', label: 'Наличные' }, { key: 'transfer', label: 'Перевод' }];
const STATUS: Record<string, string> = { ACTIVE: 'действует', USED: 'израсходован', EXPIRED: 'истёк', CANCELLED: 'отменён' };
const dateShort = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });

type Mode = null | 'topup' | 'refund' | 'sell';

/**
 * Депозит и абонементы клиента в его карточке. Деньги принимает салон и выдаёт чек сам —
 * здесь только учёт: пополнение, продажа абонемента, возврат. Визиты списываются автоматически при завершении.
 */
export function Wallet({ customerId }: { customerId: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const manage = can(me, 'finance.manage');
  const q = useQuery({ queryKey: ['account', customerId], queryFn: () => get<Account>(`/customers/${customerId}/account`) });
  const plans = useQuery({ queryKey: ['pass-plans'], queryFn: () => get<PassPlan[]>('/passes/plans'), enabled: manage });
  const [mode, setMode] = useState<Mode>(null);
  const [amount, setAmount] = useState('');
  const [bonus, setBonus] = useState<string | null>(null);
  const [method, setMethod] = useState('card');
  const [planId, setPlanId] = useState<string | null>(null);
  const [history, setHistory] = useState(false);

  const done = () => { qc.invalidateQueries({ queryKey: ['account', customerId] }); setMode(null); setAmount(''); setBonus(null); setPlanId(null); };
  const topup = useMutation({ mutationFn: () => post(`/customers/${customerId}/account/topup`, { amount: num(amount), ...(bonus !== null && bonus !== '' ? { bonus: num(bonus) } : {}), method }), onSuccess: done });
  const refund = useMutation({ mutationFn: () => post(`/customers/${customerId}/account/refund`, { amount: num(amount), method }), onSuccess: done });
  const sell = useMutation({ mutationFn: () => post(`/customers/${customerId}/passes`, { planId, method }), onSuccess: done });
  const cancelPass = useMutation({ mutationFn: (id: string) => post(`/passes/${id}/cancel`), onSuccess: done });

  const a = q.data;
  if (!a) return q.error ? <ErrorText error={q.error} /> : null;
  const autoBonus = (() => {
    const v = num(amount);
    return a.tiers.filter((t) => v >= t.amount).reduce((m, t) => Math.max(m, t.bonus), 0);
  })();
  const active = a.passes.filter((p) => p.status === 'ACTIVE');
  const askCancel = (id: string) => (Platform.OS === 'web' ? confirm('Отменить абонемент? Оставшиеся визиты сгорят.') && cancelPass.mutate(id) : cancelPass.mutate(id));

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <View>
          <Text style={{ color: C.muted }}>Депозит</Text>
          <Text style={{ fontSize: 26, fontWeight: '700' }}>{rubles(a.total)}</Text>
          {a.bonus > 0 && <Muted>из них бонусы {rubles(a.bonus)}</Muted>}
        </View>
        {active.length > 0 && <Text style={{ color: C.brand, fontWeight: '600' }}>Абонементов: {active.length}</Text>}
      </View>

      {active.map((p) => (
        <View key={p.id} style={{ backgroundColor: C.brandSoft, borderRadius: 14, padding: 10, gap: 2 }}>
          <Text style={{ fontWeight: '600' }}>{p.name}</Text>
          <Muted>{p.kind === 'VISITS' ? `осталось ${p.visitsLeft} из ${p.visitsTotal}` : 'безлимит, 1 визит в день'} · до {dateShort(p.expiresAt)}</Muted>
          {manage && <Text style={{ color: C.danger, fontSize: 13 }} onPress={() => askCancel(p.id)}>Отменить</Text>}
        </View>
      ))}

      {manage && !mode && (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button title="Пополнить" icon="add-circle-outline" onPress={() => setMode('topup')} style={{ flexGrow: 1 }} />
          <Button variant="ghost" title="Абонемент" icon="ticket-outline" onPress={() => setMode('sell')} style={{ flexGrow: 1 }} />
          {a.money > 0 && <Button variant="ghost" title="Вернуть" icon="arrow-undo-outline" onPress={() => setMode('refund')} style={{ flexGrow: 1 }} />}
        </View>
      )}

      {mode && (
        <View style={{ gap: 10 }}>
          {mode === 'topup' && a.tiers.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {a.tiers.map((t) => <Chip key={t.amount} label={`${rubles(t.amount)} → +${rubles(t.bonus)}`} active={num(amount) === t.amount} onPress={() => { setAmount(String(t.amount)); setBonus(null); }} />)}
            </View>
          )}
          {mode === 'sell' ? (
            <>
              {(plans.data ?? []).filter((p) => p.isActive).map((p) => (
                <Chip key={p.id} label={`${p.name} · ${rubles(p.price)}`} active={planId === p.id} onPress={() => setPlanId(p.id)} />
              ))}
              {(plans.data ?? []).filter((p) => p.isActive).length === 0 && (
                <Muted>Абонементов пока нет. <Text style={{ color: C.brand }} onPress={() => router.push('/loyalty')}>Создать →</Text></Muted>
              )}
            </>
          ) : (
            <Field label={mode === 'refund' ? `Сумма возврата, ₽ (не больше ${rubles(a.money)})` : 'Сумма, ₽'} value={amount} onChangeText={(v) => { setAmount(v); setBonus(null); }} keyboardType="decimal-pad" />
          )}
          {mode === 'topup' && (
            <Field label="Бонус, ₽" value={bonus ?? (autoBonus ? String(autoBonus) : '')} onChangeText={setBonus} keyboardType="decimal-pad" placeholder="0" />
          )}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {METHODS.map((m) => <Chip key={m.key} label={m.label} active={method === m.key} onPress={() => setMethod(m.key)} />)}
          </View>
          <Muted>
            {mode === 'refund'
              ? 'Возвращаются только деньги; бонусы сгорают пропорционально. Верните деньги тем же способом, которым клиент платил.'
              : 'Деньги принимает салон и выдаёт чек. Визиты спишутся сами при завершении.'}
          </Muted>
          <ErrorText error={topup.error ?? refund.error ?? sell.error} />
          <Button
            title={mode === 'topup' ? 'Пополнить' : mode === 'refund' ? 'Вернуть деньги' : 'Продать абонемент'}
            variant={mode === 'refund' ? 'danger' : 'primary'}
            loading={topup.isPending || refund.isPending || sell.isPending}
            disabled={mode === 'sell' ? !planId : !(num(amount) > 0)}
            onPress={() => (mode === 'topup' ? topup.mutate() : mode === 'refund' ? refund.mutate() : sell.mutate())}
          />
          <Button variant="ghost" title="Отмена" onPress={() => setMode(null)} />
        </View>
      )}

      {a.entries.length > 0 && (
        <Text style={{ color: C.brand, fontWeight: '600' }} onPress={() => setHistory(!history)}>{history ? 'Скрыть операции' : `Операции (${a.entries.length})`}</Text>
      )}
      {history && a.entries.map((e) => (
        <View key={e.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text>{e.label}{e.method ? ` · ${e.method}` : ''}</Text>
            <Text style={{ fontSize: 12, color: C.muted }}>{new Date(e.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{e.note ? ` · ${e.note}` : ''}</Text>
          </View>
          <Text style={{ fontWeight: '600', color: e.money + e.bonus >= 0 ? C.success : C.text }} onPress={e.bookingId ? () => router.push(`/booking/${e.bookingId}`) : undefined}>
            {e.money + e.bonus >= 0 ? '+' : ''}{rubles(e.money + e.bonus)}
          </Text>
        </View>
      ))}
    </Card>
  );
}
