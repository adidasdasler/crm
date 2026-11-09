import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { View } from 'react-native';
import { Text } from '../../components/Text';
import { Button, Card, Muted, Screen } from '../../components/ui';
import { get } from '../../lib/api';
import { scheduleText, type Schedule } from '../../lib/schedule';
import type { Resource } from '../../lib/types';

export const scheduleSummary = (r: Resource) => scheduleText(r.schedule as Schedule);

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
