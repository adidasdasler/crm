import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { Text } from '../../../components/Text';
import { Button, C, Card, Chip, ErrorText, Field, H, Loading, Muted, Screen, Toggle } from '../../../components/ui';
import { del, get, patch, post } from '../../../lib/api';
import type { Material, MaterialDetail } from '../../../lib/types';
import { dateRu, qtyText } from '../../../lib/format';

const UNITS = ['шт', 'мл', 'г', 'л', 'кг', 'пар', 'упак', 'м'];
const num = (s: string) => parseFloat(s.replace(',', '.'));
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
/** «31.12.2027» → «2027-12-31» */
const fromRu = (s: string) => { const m = s.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : s.trim(); };

type Mode = null | 'receipt' | 'writeoff' | 'edit';

/** Карточка материала: остаток, партии со сроками, журнал движений; приход, списание, правка. «new» — создание. */
export default function MaterialScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['stock', 'material', id], queryFn: () => get<MaterialDetail>(`/stock/materials/${id}`), enabled: !isNew });
  const [mode, setMode] = useState<Mode>(isNew ? 'edit' : null);
  const [f, setF] = useState({ name: '', unit: 'шт', category: '', minStock: '0', trackExpiry: false });
  const [r, setR] = useState({ qty: '', price: '', expiresAt: '', note: '' });
  const [w, setW] = useState({ qty: '', reason: '', batchId: null as string | null });
  useEffect(() => {
    if (q.data) setF({ name: q.data.name, unit: q.data.unit, category: q.data.category ?? '', minStock: String(q.data.minStock), trackExpiry: q.data.trackExpiry });
  }, [q.data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['stock'] });
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name, unit: f.unit, category: f.category || null, minStock: num(f.minStock || '0') || 0, trackExpiry: f.trackExpiry };
      return isNew ? post<Material>('/stock/materials', body) : patch<Material>(`/stock/materials/${id}`, body);
    },
    onSuccess: (m) => { refresh(); if (isNew) router.replace(`/stock/${m.id}`); else setMode(null); },
  });
  const receipt = useMutation({
    mutationFn: () => post('/stock/receipts', {
      materialId: id, qty: num(r.qty), ...(r.price ? { price: num(r.price) } : {}), ...(r.expiresAt ? { expiresAt: fromRu(r.expiresAt) } : {}), ...(r.note ? { note: r.note } : {}),
    }),
    onSuccess: () => { refresh(); setR({ qty: '', price: '', expiresAt: '', note: '' }); setMode(null); },
  });
  const writeOff = useMutation({
    mutationFn: () => post('/stock/write-off', { materialId: id, qty: num(w.qty), reason: w.reason, ...(w.batchId ? { batchId: w.batchId } : {}) }),
    onSuccess: () => { refresh(); setW({ qty: '', reason: '', batchId: null }); setMode(null); },
  });
  const remove = useMutation({ mutationFn: () => del(`/stock/materials/${id}`), onSuccess: () => { refresh(); router.back(); } });

  if (!isNew && q.isLoading) return <Loading />;
  const m = q.data;
  const askRemove = () => {
    if (Platform.OS === 'web') { if (confirm('Удалить материал? История движений сохранится.')) remove.mutate(); return; }
    Alert.alert('Удалить материал?', 'История движений сохранится', [{ text: 'Отмена', style: 'cancel' }, { text: 'Удалить', style: 'destructive', onPress: () => remove.mutate() }]);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? 'Новый материал' : m?.name ?? 'Материал' }} />
      <ErrorText error={q.error ?? save.error ?? receipt.error ?? writeOff.error ?? remove.error} />

      {m && mode !== 'edit' && (
        <Card style={{ backgroundColor: C.text, borderColor: C.text }}>
          <Text style={{ color: '#C9CCF2' }}>Остаток</Text>
          <Text style={{ color: m.stock < 0 ? '#FFB4A3' : '#fff', fontSize: 34, fontWeight: '700' }}>{qtyText(m.stock, m.unit)}</Text>
          <Text style={{ color: '#C9CCF2' }}>
            {m.low ? `Заканчивается: порог ${qtyText(m.minStock, m.unit)}` : m.minStock ? `Порог «заканчивается»: ${qtyText(m.minStock, m.unit)}` : 'Порог не задан'}
            {m.price ? ` · ${m.price.toLocaleString('ru-RU')} ₽/${m.unit} · на ${Math.round(m.value).toLocaleString('ru-RU')} ₽` : ''}
          </Text>
          {m.stock < 0 && <Text style={{ color: '#FFB4A3' }}>Списано больше, чем оприходовано — внесите приход.</Text>}
        </Card>
      )}

      {m && !mode && (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button title="Приход" icon="add-circle-outline" onPress={() => setMode('receipt')} style={{ flexGrow: 1 }} />
          <Button variant="ghost" title="Списать" icon="remove-circle-outline" onPress={() => setMode('writeoff')} style={{ flexGrow: 1 }} />
          <Button variant="ghost" title="Изменить" icon="create-outline" onPress={() => setMode('edit')} style={{ flexGrow: 1 }} />
        </View>
      )}

      {mode === 'receipt' && m && (
        <Card>
          <H>Приход</H>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Field label={`Количество, ${m.unit}`} value={r.qty} onChangeText={(qty) => setR({ ...r, qty })} keyboardType="decimal-pad" /></View>
            <View style={{ flex: 1 }}><Field label={`Цена за ${m.unit}, ₽`} value={r.price} onChangeText={(price) => setR({ ...r, price })} keyboardType="decimal-pad" placeholder={m.price ? String(m.price) : ''} /></View>
          </View>
          {m.trackExpiry && <Field label="Годен до (ДД.ММ.ГГГГ)" value={r.expiresAt} onChangeText={(expiresAt) => setR({ ...r, expiresAt })} placeholder="31.12.2027" keyboardType="numbers-and-punctuation" />}
          <Field label="Комментарий" value={r.note} onChangeText={(note) => setR({ ...r, note })} placeholder="Поставщик, номер накладной" />
          <Button title="Оприходовать" onPress={() => receipt.mutate()} loading={receipt.isPending}
            disabled={!(num(r.qty) > 0) || (m.trackExpiry && !isDate(fromRu(r.expiresAt)))} />
          <Button variant="ghost" title="Отмена" onPress={() => setMode(null)} />
        </Card>
      )}

      {mode === 'writeoff' && m && (
        <Card>
          <H>Списание</H>
          <Muted>Брак, истёк срок, израсходовано вне визитов. Расход на визиты списывается сам.</Muted>
          {m.batches.length > 1 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip label="По сроку (авто)" active={!w.batchId} onPress={() => setW({ ...w, batchId: null })} />
              {m.batches.map((b) => <Chip key={b.id} label={`${b.expiresAt ? `до ${dateRu(b.expiresAt)}` : 'без срока'} · ${qtyText(b.remaining, m.unit)}`} active={w.batchId === b.id} onPress={() => setW({ ...w, batchId: b.id })} />)}
            </View>
          )}
          <Field label={`Количество, ${m.unit}`} value={w.qty} onChangeText={(qty) => setW({ ...w, qty })} keyboardType="decimal-pad" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {['Истёк срок', 'Брак', 'Пролито / разбито', 'Личное использование'].map((x) => <Chip key={x} label={x} active={w.reason === x} onPress={() => setW({ ...w, reason: x })} />)}
          </View>
          <Field label="Причина" value={w.reason} onChangeText={(reason) => setW({ ...w, reason })} />
          <Button title="Списать" variant="danger" onPress={() => writeOff.mutate()} loading={writeOff.isPending} disabled={!(num(w.qty) > 0) || !w.reason.trim()} />
          <Button variant="ghost" title="Отмена" onPress={() => setMode(null)} />
        </Card>
      )}

      {mode === 'edit' && (
        <Card>
          <Field label="Название" value={f.name} onChangeText={(name) => setF({ ...f, name })} placeholder="Гель-лак" />
          <Muted>Единица измерения</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {UNITS.map((u) => <Chip key={u} label={u} active={f.unit === u} onPress={() => setF({ ...f, unit: u })} />)}
          </View>
          <Field label="Категория" value={f.category} onChangeText={(category) => setF({ ...f, category })} placeholder="Покрытия" />
          <Field label={`Предупредить, когда останется меньше, ${f.unit}`} value={f.minStock} onChangeText={(minStock) => setF({ ...f, minStock })} keyboardType="decimal-pad" />
          <Toggle label="Учитывать срок годности" hint="При приходе нужно указать дату, расход идёт с партий, которые истекают раньше" value={f.trackExpiry} onChange={(trackExpiry) => setF({ ...f, trackExpiry })} />
          <Button title="Сохранить" onPress={() => save.mutate()} loading={save.isPending} disabled={!f.name.trim()} />
          {!isNew && <Button variant="ghost" title="Отмена" onPress={() => setMode(null)} />}
          {!isNew && <Button variant="danger" title="Удалить материал" onPress={askRemove} loading={remove.isPending} />}
        </Card>
      )}

      {m && !mode && (
        <>
          {m.batches.length > 0 && <H>Партии</H>}
          {m.batches.map((b) => {
            const expired = b.expiresAt && b.expiresAt < new Date().toISOString().slice(0, 10);
            return (
              <Card key={b.id}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontWeight: '600', color: expired ? C.danger : C.text }}>{b.expiresAt ? `${expired ? 'Истёк' : 'Годен до'} ${dateRu(b.expiresAt)}` : 'Без срока годности'}</Text>
                  <Text style={{ fontWeight: '700' }}>{qtyText(b.remaining, m.unit)}</Text>
                </View>
                <Muted>Приход {new Date(b.receivedAt).toLocaleDateString('ru-RU')}: {qtyText(b.qty, m.unit)}{b.price ? ` по ${b.price.toLocaleString('ru-RU')} ₽` : ''}</Muted>
              </Card>
            );
          })}
          <H>Расход на услуги</H>
          {m.norms.length ? m.norms.map((n) => <Muted key={n.serviceId}>{n.service}: {qtyText(n.qty, m.unit)} за визит</Muted>) : <Muted>Нормы задаются в карточке услуги → «Расход материалов».</Muted>}
          <H>Движения</H>
          {m.movements.length === 0 && <Muted>Пока нет</Muted>}
          {m.movements.map((mv) => (
            <View key={mv.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingVertical: 4 }}>
              <View style={{ flex: 1 }}>
                <Text>{mv.label}{mv.note ? ` · ${mv.note}` : ''}</Text>
                <Text style={{ fontSize: 12, color: C.muted }}>{new Date(mv.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
              </View>
              <Text style={{ fontWeight: '600', color: mv.qty > 0 ? C.success : C.text }} onPress={mv.bookingId ? () => router.push(`/booking/${mv.bookingId}`) : undefined}>
                {mv.qty > 0 ? '+' : ''}{qtyText(mv.qty, m.unit)}
              </Text>
            </View>
          ))}
        </>
      )}
    </Screen>
  );
}
