import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '../../../components/Text';
import { Button, C, Card, Chip, Empty, ErrorText, Field, Loading, Muted, Screen } from '../../../components/ui';
import { get, post } from '../../../lib/api';
import { dateRu, qtyText } from '../../../lib/format';
import type { Material, StockAlerts } from '../../../lib/types';


type Filter = 'all' | 'low' | 'expiry';

/** Склад: остатки, предупреждения «заканчивается» и «истекает срок», быстрый переход к приходу */
export default function Stock() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['stock', 'materials'], queryFn: () => get<Material[]>('/stock/materials') });
  const alerts = useQuery({ queryKey: ['stock', 'alerts'], queryFn: () => get<StockAlerts>('/stock/alerts') });
  const tpl = useQuery({ queryKey: ['stock', 'template'], queryFn: () => get<{ industry: string; materials: { name: string }[] }>('/stock/template') });
  const fromTpl = useMutation({
    mutationFn: () => post<{ created: number; linked: number }>('/stock/from-template'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock'] }),
  });

  const expiringIds = useMemo(() => new Set((alerts.data?.expiring ?? []).map((e) => e.materialId)), [alerts.data]);
  const rows = (list.data ?? []).filter((m) =>
    (filter === 'all' || (filter === 'low' ? m.low : expiringIds.has(m.id))) && (!q || m.name.toLowerCase().includes(q.toLowerCase())),
  );
  if (list.isLoading) return <Loading />;
  const today = new Date().toISOString().slice(0, 10);
  const total = (list.data ?? []).reduce((s, m) => s + m.value, 0);
  const lowN = alerts.data?.low.length ?? 0;
  const expN = alerts.data?.expiring.length ?? 0;

  return (
    <Screen>
      <ErrorText error={list.error ?? fromTpl.error} />
      {(list.data ?? []).length === 0 ? (
        <Card>
          <Empty icon="cube-outline" text={'Склад пуст.\nДобавьте материалы — расход будет списываться сам при завершении визита.'} />
          {(tpl.data?.materials.length ?? 0) > 0 && (
            <>
              <Muted>Готовый набор для вашей сферы: {tpl.data!.materials.map((m) => m.name).join(', ')}. Нормы расхода сразу привяжутся к вашим услугам.</Muted>
              <Button title="Добавить набор материалов" icon="sparkles-outline" onPress={() => fromTpl.mutate()} loading={fromTpl.isPending} />
            </>
          )}
          <Button variant="ghost" title="Добавить материал вручную" icon="add" onPress={() => router.push('/stock/new')} />
        </Card>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Stat label="На складе" value={`${Math.round(total).toLocaleString('ru-RU')} ₽`} />
            <Stat label="Мало" value={String(lowN)} tone={lowN ? 'warn' : undefined} onPress={() => setFilter('low')} />
            <Stat label="Истекает" value={String(expN)} tone={expN ? 'bad' : undefined} onPress={() => setFilter('expiry')} />
          </View>
          {(alerts.data?.expiring ?? []).slice(0, 3).map((e) => (
            <Pressable key={e.batchId} onPress={() => router.push(`/stock/${e.materialId}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16, backgroundColor: e.expired ? '#FDECE7' : '#FFF4DB' }}>
              <Ionicons name={e.expired ? 'alert-circle' : 'time-outline'} size={20} color={e.expired ? C.danger : '#9A6B00'} />
              <Text style={{ flex: 1 }}>
                {e.name}: {qtyText(e.remaining, e.unit)} — {e.expired ? 'срок истёк' : e.daysLeft === 0 ? 'срок истекает сегодня' : `срок истекает через ${e.daysLeft} дн.`}
              </Text>
            </Pressable>
          ))}
          <Field value={q} onChangeText={setQ} placeholder="Поиск материала" />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Chip label="Все" active={filter === 'all'} onPress={() => setFilter('all')} />
            <Chip label={`Заканчивается${lowN ? ` · ${lowN}` : ''}`} active={filter === 'low'} onPress={() => setFilter('low')} />
            <Chip label={`Срок годности${expN ? ` · ${expN}` : ''}`} active={filter === 'expiry'} onPress={() => setFilter('expiry')} />
          </View>
          {rows.map((m) => (
            <Card key={m.id} onPress={() => router.push(`/stock/${m.id}`)}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '600' }}>{m.name}</Text>
                  <Muted>{m.category ?? ' '}</Muted>
                  {m.nearestExpiry && (
                    <Text style={{ fontSize: 13, color: m.nearestExpiry < today ? C.danger : C.muted }}>
                      {m.nearestExpiry < today ? `срок истёк ${dateRu(m.nearestExpiry)}` : `годен до ${dateRu(m.nearestExpiry)}`}
                    </Text>
                  )}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: m.stock < 0 ? C.danger : m.low ? '#9A6B00' : C.text }}>{qtyText(m.stock, m.unit)}</Text>
                  {m.low && <Text style={{ fontSize: 12, color: '#9A6B00' }}>заканчивается</Text>}
                </View>
              </View>
            </Card>
          ))}
          {rows.length === 0 && <Muted>Ничего не нашли</Muted>}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button title="Материал" icon="add" onPress={() => router.push('/stock/new')} style={{ flexGrow: 1 }} />
            <Button variant="ghost" title="Инвентаризация" icon="clipboard-outline" onPress={() => router.push('/stock/inventory')} style={{ flexGrow: 1 }} />
          </View>
        </>
      )}
    </Screen>
  );
}

function Stat({ label, value, tone, onPress }: { label: string; value: string; tone?: 'warn' | 'bad'; onPress?: () => void }) {
  const color = tone === 'bad' ? C.danger : tone === 'warn' ? '#9A6B00' : C.text;
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={{ flex: 1, backgroundColor: C.card, borderRadius: 18, padding: 12, borderWidth: 1, borderColor: '#EEF0F7' }}>
      <Text style={{ fontSize: 12, color: C.muted }} numberOfLines={1}>{label}</Text>
      <Text style={{ fontSize: 20, fontWeight: '700', color }} numberOfLines={1}>{value}</Text>
    </Pressable>
  );
}
