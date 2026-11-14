import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, ScrollView } from 'react-native';
import { get } from '../lib/api';
import type { Design } from '../lib/types';
import { DesignImage } from './DesignImage';
import { Text } from './Text';
import { Card, Muted } from './ui';

/** «Что делали в прошлый раз» — фото работ этого клиента */
export function PastDesigns({ customerId }: { customerId: string }) {
  const q = useQuery({ queryKey: ['designs', 'customer', customerId], queryFn: () => get<Design[]>(`/designs?customerId=${customerId}&limit=20`) });
  if (!q.data?.length) return null;
  return (
    <Card>
      <Text style={{ fontWeight: '600' }}>Прошлые работы</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {q.data.map((d) => (
          <Pressable key={d.id} onPress={() => router.push(`/designs/${d.id}`)} accessibilityRole="imagebutton" accessibilityLabel={d.title ?? 'Фото работы'}>
            <DesignImage id={d.id} style={{ width: 96, height: 96, borderRadius: 12 }} />
            <Muted>{new Date(d.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</Muted>
          </Pressable>
        ))}
      </ScrollView>
    </Card>
  );
}
