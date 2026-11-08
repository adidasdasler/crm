import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, TextInput, View } from 'react-native';
import { Text } from '../../../components/Text';
import { Button, C, Card, ErrorText, Loading, Muted, Screen } from '../../../components/ui';
import { get, post } from '../../../lib/api';
import type { Material } from '../../../lib/types';
import { qtyText } from '../../../lib/format';

/** Инвентаризация: пересчитали полку — ввели факт; разница уходит в журнал, расход идёт по сроку годности */
export default function Inventory() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['stock', 'materials'], queryFn: () => get<Material[]>('/stock/materials') });
  const [actual, setActual] = useState<Record<string, string>>({});
  const items = Object.entries(actual).filter(([, v]) => v.trim() !== '').map(([materialId, v]) => ({ materialId, actual: parseFloat(v.replace(',', '.')) }));
  const valid = items.length > 0 && items.every((i) => i.actual >= 0);
  const save = useMutation({
    mutationFn: () => post<{ items: { materialId: string; diff: number }[] }>('/stock/inventory', { items }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['stock'] });
      const changed = r.items.filter((i) => i.diff !== 0).length;
      const msg = changed ? `Готово. Остатки поправлены у ${changed} материалов.` : 'Готово. Расхождений нет.';
      if (Platform.OS === 'web') alert(msg);
      router.back();
    },
  });
  if (list.isLoading) return <Loading />;
  return (
    <Screen>
      <Muted>Введите фактический остаток только для пересчитанных материалов. Пустые поля не меняются.</Muted>
      <ErrorText error={save.error} />
      {(list.data ?? []).map((m) => {
        const v = actual[m.id] ?? '';
        const n = parseFloat(v.replace(',', '.'));
        const diff = v.trim() !== '' && !Number.isNaN(n) ? Math.round((n - m.stock) * 1000) / 1000 : null;
        return (
          <Card key={m.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '600' }}>{m.name}</Text>
                <Muted>По учёту: {qtyText(m.stock, m.unit)}{diff !== null && diff !== 0 ? ` · ${diff > 0 ? '+' : ''}${qtyText(diff, m.unit)}` : ''}</Muted>
              </View>
              <TextInput
                value={v}
                onChangeText={(t) => setActual({ ...actual, [m.id]: t })}
                keyboardType="decimal-pad"
                placeholder="факт"
                placeholderTextColor="#94a3b8"
                accessibilityLabel={`Фактический остаток: ${m.name}`}
                style={{ width: 96, borderWidth: 1, borderColor: diff ? C.brand : C.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, textAlign: 'right', color: C.text, backgroundColor: C.card }}
              />
            </View>
          </Card>
        );
      })}
      <Button title={items.length ? `Сохранить (${items.length})` : 'Сохранить'} onPress={() => save.mutate()} loading={save.isPending} disabled={!valid} />
    </Screen>
  );
}
