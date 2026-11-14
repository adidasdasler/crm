import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { TextInput } from 'react-native';
import { Text } from '../../../components/Text';
import { can, useMe } from '../../../lib/auth';
import { Alert, Platform, View } from 'react-native';
import { Button, C, Chip, ErrorText, Field, H, Loading, Muted, Screen, Toggle } from '../../../components/ui';
import { del, get, patch, post, put } from '../../../lib/api';
import type { Material, Resource, Service } from '../../../lib/types';

type Norm = { materialId: string; name: string; unit: string; qty: string };

export default function ServiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const qc = useQueryClient();
  const services = useQuery({ queryKey: ['services'], queryFn: () => get<Service[]>('/services') });
  const resources = useQuery({ queryKey: ['resources'], queryFn: () => get<Resource[]>('/resources') });
  const existing = services.data?.find((s) => s.id === id);
  const me = useMe();
  const stockOn = can(me, 'stock.manage') || can(me, 'catalog.manage');
  const materials = useQuery({ queryKey: ['stock', 'materials'], queryFn: () => get<Material[]>('/stock/materials'), enabled: stockOn });
  const normsQ = useQuery({ queryKey: ['stock', 'norms', id], queryFn: () => get<{ materialId: string; name: string; unit: string; qty: number }[]>(`/stock/norms/${id}`), enabled: stockOn && !isNew });
  const [norms, setNorms] = useState<Norm[] | null>(null);
  useEffect(() => { if (normsQ.data && norms === null) setNorms(normsQ.data.map((n) => ({ ...n, qty: String(n.qty) }))); }, [normsQ.data, norms]);
  const [f, setF] = useState({ name: '', description: '', price: '', duration: '60', bufferTime: '0', isActive: true, isPublic: true, resourceIds: [] as string[], comboOf: [] as string[] });

  useEffect(() => {
    if (existing) {
      setF({
        name: existing.name, description: existing.description ?? '', price: String(existing.price / 100), duration: String(existing.duration),
        bufferTime: String(existing.bufferTime), isActive: existing.isActive, isPublic: existing.isPublic, resourceIds: existing.resourceIds, comboOf: existing.comboOf ?? [],
      });
    } else if (isNew && resources.data) setF((x) => ({ ...x, resourceIds: resources.data.map((r) => r.id) }));
  }, [existing, isNew, resources.data]);

  const done = () => { qc.invalidateQueries({ queryKey: ['services'] }); qc.invalidateQueries({ queryKey: ['resources'] }); router.back(); };
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: f.name, description: f.description || null, price: Math.round(parseFloat(f.price.replace(',', '.') || '0') * 100),
        duration: parseInt(f.duration, 10), bufferTime: parseInt(f.bufferTime || '0', 10), isActive: f.isActive, isPublic: f.isPublic, resourceIds: f.resourceIds, comboOf: f.comboOf,
      };
      const saved = await (isNew ? post<Service>('/services', body) : patch<Service>(`/services/${id}`, body));
      if (norms) {
        await put(`/stock/norms/${saved.id}`, { items: norms.filter((n) => parseFloat(n.qty.replace(',', '.')) > 0).map((n) => ({ materialId: n.materialId, qty: parseFloat(n.qty.replace(',', '.')) })) });
        qc.invalidateQueries({ queryKey: ['stock'] });
      }
      return saved;
    },
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: () => del(`/services/${id}`), onSuccess: done });

  if (!isNew && !existing) return services.isLoading ? <Loading /> : <Screen><ErrorText error={new Error('Услуга не найдена')} /></Screen>;

  const askRemove = () => {
    if (Platform.OS === 'web') { if (confirm('Удалить услугу?')) remove.mutate(); return; }
    Alert.alert('Удалить услугу?', 'Прошлые записи сохранятся', [{ text: 'Отмена', style: 'cancel' }, { text: 'Удалить', style: 'destructive', onPress: () => remove.mutate() }]);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? 'Новая услуга' : 'Услуга' }} />
      <Field label="Название" value={f.name} onChangeText={(name) => setF({ ...f, name })} placeholder="Маникюр с покрытием" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Field label="Цена, ₽" value={f.price} onChangeText={(price) => setF({ ...f, price })} keyboardType="decimal-pad" /></View>
        <View style={{ flex: 1 }}><Field label="Длительность, мин" value={f.duration} onChangeText={(duration) => setF({ ...f, duration })} keyboardType="number-pad" /></View>
      </View>
      <Field label="Перерыв после, мин" value={f.bufferTime} onChangeText={(bufferTime) => setF({ ...f, bufferTime })} keyboardType="number-pad" />
      <Muted>Перерыв — время на уборку/подготовку. Клиент его не видит, но мастер в это время занят.</Muted>
      <Field label="Описание для клиентов" value={f.description} onChangeText={(description) => setF({ ...f, description })} multiline />
      <H>Комплекс</H>
      <Muted>Отметьте 2–5 услуг, если это набор со своей ценой (например, «стрижка + борода»). Клиент увидит метку «Комплекс» и свою выгоду.</Muted>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(services.data ?? []).filter((s) => s.id !== id && !s.comboOf?.length && s.isActive).map((s) => (
          <Chip key={s.id} label={s.name} active={f.comboOf.includes(s.id)}
            onPress={() => setF({ ...f, comboOf: f.comboOf.includes(s.id) ? f.comboOf.filter((x) => x !== s.id) : [...f.comboOf, s.id].slice(0, 5) })} />
        ))}
      </View>
      {f.comboOf.length > 0 && (() => {
        const sum = (services.data ?? []).filter((s) => f.comboOf.includes(s.id)).reduce((a, s) => a + s.price, 0);
        const price = Math.round(parseFloat(f.price.replace(',', '.') || '0') * 100);
        return <Muted>{f.comboOf.length < 2 ? 'Выберите ещё хотя бы одну услугу' : `По отдельности ${Math.round(sum / 100)} ₽${sum > price ? ` · выгода клиента ${Math.round((sum - price) / 100)} ₽` : ''}`}</Muted>;
      })()}
      {stockOn && (materials.data?.length ?? 0) > 0 && (
        <>
          <H>Расход материалов</H>
          <Muted>Сколько уходит на одну услугу. При завершении визита спишется со склада автоматически.</Muted>
          {(norms ?? []).map((n, i) => (
            <View key={n.materialId} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1 }}>{n.name}</Text>
              <TextInput
                value={n.qty}
                onChangeText={(qty) => setNorms((norms ?? []).map((x, j) => (j === i ? { ...x, qty } : x)))}
                keyboardType="decimal-pad"
                accessibilityLabel={`Расход: ${n.name}`}
                style={{ width: 72, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, textAlign: 'right', color: C.text, backgroundColor: C.card }}
              />
              <Text style={{ width: 40, color: C.muted }}>{n.unit}</Text>
              <Text style={{ color: C.danger, fontWeight: '600' }} onPress={() => setNorms((norms ?? []).filter((_, j) => j !== i))}>✕</Text>
            </View>
          ))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(materials.data ?? []).filter((m) => m.isActive && !(norms ?? []).some((n) => n.materialId === m.id)).map((m) => (
              <Chip key={m.id} label={`+ ${m.name}`} onPress={() => setNorms([...(norms ?? []), { materialId: m.id, name: m.name, unit: m.unit, qty: '' }])} />
            ))}
          </View>
          {f.comboOf.length > 0 && !(norms ?? []).length && <Muted>Для комплекса без своих норм спишутся нормы входящих услуг.</Muted>}
        </>
      )}
      <H>Кто оказывает</H>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(resources.data ?? []).map((r) => (
          <Chip key={r.id} label={r.name} color={r.color} active={f.resourceIds.includes(r.id)}
            onPress={() => setF({ ...f, resourceIds: f.resourceIds.includes(r.id) ? f.resourceIds.filter((x) => x !== r.id) : [...f.resourceIds, r.id] })} />
        ))}
      </View>
      <Toggle label="Показывать в онлайн-записи" value={f.isPublic} onChange={(isPublic) => setF({ ...f, isPublic })} />
      <Toggle label="Активна" value={f.isActive} onChange={(isActive) => setF({ ...f, isActive })} />
      <ErrorText error={save.error ?? remove.error} />
      <Button title="Сохранить" onPress={() => save.mutate()} loading={save.isPending} disabled={!f.name || !(parseInt(f.duration, 10) >= 5) || f.comboOf.length === 1} />
      {!isNew && <Button title="Удалить услугу" variant="danger" onPress={askRemove} loading={remove.isPending} />}
    </Screen>
  );
}
