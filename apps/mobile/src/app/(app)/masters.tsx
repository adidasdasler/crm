import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Button, Card, Muted, Screen } from '../../components/ui';
import { get } from '../../lib/api';
import type { Resource } from '../../lib/types';

const WD = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const scheduleSummary = (r: Resource) =>
  (['1', '2', '3', '4', '5', '6', '7'] as const).filter((d) => r.schedule[d]?.length).map((d) => WD[+d]).join(', ') || 'Нет рабочих дней';

export default function Masters() {
  const list = useQuery({ queryKey: ['resources', 'all'], queryFn: () => get<Resource[]>('/resources?all=1') });
  return (
    <Screen>
      {(list.data ?? []).map((r) => (
        <Card key={r.id} onPress={() => router.push(`/master/${r.id}`)} style={{ opacity: r.isActive ? 1 : 0.5 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: r.color }} />
            <Text style={{ fontSize: 16, fontWeight: '600' }}>{r.name}</Text>
          </View>
          <Muted>{r.position ? `${r.position} · ` : ''}{scheduleSummary(r)}</Muted>
        </Card>
      ))}
      <Button title="Добавить мастера" icon="add" onPress={() => router.push('/master/new')} />
    </Screen>
  );
}
