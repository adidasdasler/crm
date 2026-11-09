import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from '../../components/Text';
import { Button, C, Card, Chip, ErrorText, Field, H, Loading, Muted, Screen, Toggle } from '../../components/ui';
import { del, get, patch, post } from '../../lib/api';
import { can, useMe } from '../../lib/auth';
import type { PassPlan, Service, Tenant } from '../../lib/types';

const rubles = (n: number) => `${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
const num = (s: string) => parseFloat(s.replace(',', '.').replace(/\s/g, ''));
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

type Form = { id?: string; name: string; description: string; kind: 'VISITS' | 'UNLIMITED'; visits: string; validityDays: string; price: string; serviceIds: string[]; days: number[]; from: string; to: string; isPublic: boolean };
const empty: Form = { name: '', description: '', kind: 'VISITS', visits: '10', validityDays: '60', price: '', serviceIds: [], days: [], from: '', to: '', isPublic: true };

const ruleText = (r: PassPlan['timeRule']) =>
  !r ? '' : [r.days?.length ? r.days.map((d) => WD[d - 1]).join(', ') : null, r.from || r.to ? `${r.from ?? '00:00'}–${r.to ?? '24:00'}` : null].filter(Boolean).join(' · ');

/**
 * Депозиты и абонементы: ступени «пополни на 5000 — получи +500», автосписание за визит,
 * виды абонементов (на визиты или безлимит, срок, услуги, непиковые часы).
 */
export default function Loyalty() {
  const me = useMe();
  const qc = useQueryClient();
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: () => get<Tenant>('/tenant') });
  const plans = useQuery({ queryKey: ['pass-plans'], queryFn: () => get<PassPlan[]>('/passes/plans') });
  const services = useQuery({ queryKey: ['services'], queryFn: () => get<Service[]>('/services') });
  const [tiers, setTiers] = useState<{ amount: string; bonus: string }[]>([]);
  const [auto, setAuto] = useState(true);
  const [f, setF] = useState<Form | null>(null);
  useEffect(() => {
    if (tenant.data) {
      setTiers(tenant.data.settings.depositTiers.map((t) => ({ amount: String(t.amount / 100), bonus: String(t.bonus / 100) })));
      setAuto(tenant.data.settings.depositAutoCharge);
    }
  }, [tenant.data]);

  const saveTiers = useMutation({
    mutationFn: () => patch<Tenant>('/tenant', {
      settings: {
        depositAutoCharge: auto,
        depositTiers: tiers.filter((t) => num(t.amount) > 0).map((t) => ({ amount: Math.round(num(t.amount) * 100), bonus: Math.round((num(t.bonus) || 0) * 100) })).sort((a, b) => a.amount - b.amount),
      },
    }),
    onSuccess: (t) => qc.setQueryData(['tenant'], t),
  });
  const savePlan = useMutation({
    mutationFn: () => {
      const body = {
        name: f!.name, description: f!.description || null, kind: f!.kind, visits: f!.kind === 'VISITS' ? parseInt(f!.visits, 10) : null,
        validityDays: parseInt(f!.validityDays, 10), price: num(f!.price), serviceIds: f!.serviceIds, isPublic: f!.isPublic,
        timeRule: f!.days.length || f!.from || f!.to ? { ...(f!.days.length ? { days: f!.days } : {}), ...(f!.from ? { from: f!.from } : {}), ...(f!.to ? { to: f!.to } : {}) } : null,
      };
      return f!.id ? patch(`/passes/plans/${f!.id}`, body) : post('/passes/plans', body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pass-plans'] }); setF(null); },
  });
  const archive = useMutation({ mutationFn: (id: string) => del(`/passes/plans/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['pass-plans'] }) });

  if (tenant.isLoading || plans.isLoading) return <Loading />;
  const editSettings = can(me, 'settings.manage');
  const editPlans = can(me, 'finance.manage');

  return (
    <Screen>
      <Card style={{ backgroundColor: C.text, borderColor: C.text }}>
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 17 }}>Деньги вперёд — клиент возвращается</Text>
        <Text style={{ color: '#C9CCF2' }}>
          Клиент пополняет депозит или покупает абонемент в салоне — и выбирает вас снова: деньги уже внесены. Деньги принимает салон и выдаёт чек, MioFlow ведёт учёт и сам списывает визиты.
        </Text>
      </Card>

      <H>Депозит с бонусом</H>
      <Muted>Ступени: «пополни на сумму — получи бонус». Бонус не возвращается; при возврате денег сгорает пропорционально.</Muted>
      {tiers.map((t, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}><Field label="Пополнение, ₽" value={t.amount} editable={editSettings} onChangeText={(amount) => setTiers(tiers.map((x, j) => (j === i ? { ...x, amount } : x)))} keyboardType="decimal-pad" /></View>
          <View style={{ flex: 1 }}><Field label="Бонус, ₽" value={t.bonus} editable={editSettings} onChangeText={(bonus) => setTiers(tiers.map((x, j) => (j === i ? { ...x, bonus } : x)))} keyboardType="decimal-pad" /></View>
          {editSettings && <Text style={{ color: C.danger, fontWeight: '700', paddingBottom: 16 }} onPress={() => setTiers(tiers.filter((_, j) => j !== i))}>✕</Text>}
        </View>
      ))}
      {editSettings && (
        <>
          {tiers.length < 6 && <Button variant="ghost" icon="add" title="Добавить ступень" onPress={() => setTiers([...tiers, tiers.length ? { amount: '', bonus: '' } : { amount: '5000', bonus: '500' }])} />}
          <Toggle label="Списывать визиты с депозита автоматически" hint="При отметке «визит завершён», если у клиента нет подходящего абонемента" value={auto} onChange={setAuto} />
          <ErrorText error={saveTiers.error} />
          <Button title="Сохранить" onPress={() => saveTiers.mutate()} loading={saveTiers.isPending} />
        </>
      )}

      <H>Абонементы</H>
      {(plans.data ?? []).map((p) => (
        <Card key={p.id} style={{ opacity: p.isActive ? 1 : 0.5 }} onPress={editPlans && p.isActive ? () => setF({
          id: p.id, name: p.name, description: p.description ?? '', kind: p.kind, visits: String(p.visits ?? 10), validityDays: String(p.validityDays), price: String(p.price),
          serviceIds: p.serviceIds, days: p.timeRule?.days ?? [], from: p.timeRule?.from ?? '', to: p.timeRule?.to ?? '', isPublic: p.isPublic,
        }) : undefined}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: '700', fontSize: 16, flex: 1 }}>{p.name}</Text>
            <Text style={{ fontWeight: '700' }}>{rubles(p.price)}</Text>
          </View>
          <Muted>
            {p.kind === 'VISITS' ? `${p.visits} визитов` : 'Безлимит (1 визит в день)'} · {p.validityDays} дн.
            {p.serviceIds.length ? ` · услуг: ${p.serviceIds.length}` : ' · любые услуги'}{ruleText(p.timeRule) ? ` · ${ruleText(p.timeRule)}` : ''}
            {!p.isActive ? ' · в архиве' : !p.isPublic ? ' · не на сайте' : ''}
          </Muted>
        </Card>
      ))}
      {(plans.data ?? []).length === 0 && <Muted>Например: «5 маникюров за 2 месяца — 9 900 ₽» или «Утренние стрижки: 10 визитов в будни до 14:00».</Muted>}

      {editPlans && !f && <Button icon="add" title="Новый абонемент" onPress={() => setF(empty)} />}
      {f && (
        <Card>
          <Field label="Название" value={f.name} onChangeText={(name) => setF({ ...f, name })} placeholder="5 маникюров" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip label="На визиты" active={f.kind === 'VISITS'} onPress={() => setF({ ...f, kind: 'VISITS' })} />
            <Chip label="Безлимит" active={f.kind === 'UNLIMITED'} onPress={() => setF({ ...f, kind: 'UNLIMITED' })} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {f.kind === 'VISITS' && <View style={{ flex: 1 }}><Field label="Визитов" value={f.visits} onChangeText={(visits) => setF({ ...f, visits })} keyboardType="number-pad" /></View>}
            <View style={{ flex: 1 }}><Field label="Срок, дней" value={f.validityDays} onChangeText={(validityDays) => setF({ ...f, validityDays })} keyboardType="number-pad" /></View>
            <View style={{ flex: 1 }}><Field label="Цена, ₽" value={f.price} onChangeText={(price) => setF({ ...f, price })} keyboardType="decimal-pad" /></View>
          </View>
          <Muted>Услуги (не выбрано — любые)</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(services.data ?? []).filter((s) => s.isActive).map((s) => (
              <Chip key={s.id} label={s.name} active={f.serviceIds.includes(s.id)} onPress={() => setF({ ...f, serviceIds: f.serviceIds.includes(s.id) ? f.serviceIds.filter((x) => x !== s.id) : [...f.serviceIds, s.id] })} />
            ))}
          </View>
          <Muted>Только в эти дни и часы (непиковое время, необязательно)</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {WD.map((d, i) => <Chip key={d} label={d} active={f.days.includes(i + 1)} onPress={() => setF({ ...f, days: f.days.includes(i + 1) ? f.days.filter((x) => x !== i + 1) : [...f.days, i + 1].sort() })} />)}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Field label="С (ЧЧ:ММ)" value={f.from} onChangeText={(from) => setF({ ...f, from })} placeholder="10:00" keyboardType="numbers-and-punctuation" /></View>
            <View style={{ flex: 1 }}><Field label="До (ЧЧ:ММ)" value={f.to} onChangeText={(to) => setF({ ...f, to })} placeholder="14:00" keyboardType="numbers-and-punctuation" /></View>
          </View>
          <Field label="Описание для клиентов" value={f.description} onChangeText={(description) => setF({ ...f, description })} multiline />
          <Toggle label="Показывать на странице записи" value={f.isPublic} onChange={(isPublic) => setF({ ...f, isPublic })} />
          <ErrorText error={savePlan.error ?? archive.error} />
          <Button title="Сохранить" onPress={() => savePlan.mutate()} loading={savePlan.isPending}
            disabled={!f.name.trim() || !(num(f.price) >= 0) || !(parseInt(f.validityDays, 10) > 0) || (f.kind === 'VISITS' && !(parseInt(f.visits, 10) > 0))} />
          {f.id && <Button variant="danger" title="В архив" onPress={() => { archive.mutate(f.id!); setF(null); }} />}
          <Button variant="ghost" title="Отмена" onPress={() => setF(null)} />
          <Muted>Уже проданные абонементы не меняются — условия фиксируются в момент продажи.</Muted>
        </Card>
      )}
    </Screen>
  );
}
