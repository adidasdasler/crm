import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { Linking, Pressable, View } from 'react-native';
import { Text } from '../../components/Text';
import { C, Card, Empty, ErrorText, Muted, Screen } from '../../components/ui';
import { get, patch } from '../../lib/api';
import { useMe } from '../../lib/auth';
import { dayTitle } from '../../lib/format';
import type { Resource, WaitlistItem } from '../../lib/types';

/** Лист ожидания на день: кто ждёт окно. Позвонить, записать, убрать из списка. */
export default function Waitlist() {
  const me = useMe();
  const { day = '' } = useLocalSearchParams<{ day: string }>();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['waitlist', day], queryFn: () => get<WaitlistItem[]>(`/waitlist?date=${day}`) });
  const resources = useQuery({ queryKey: ['resources'], queryFn: () => get<Resource[]>('/resources') });
  const done = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'DONE' | 'CANCELLED' }) => patch(`/waitlist/${id}`, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['waitlist'] }),
  });

  return (
    <Screen>
      <Muted>{dayTitle(day, me.tenant.timezone)}. Клиенты оставили заявку на сайте: в этот день не было свободного времени. Когда окно освобождается, клиенту с email приходит письмо, а вам — уведомление.</Muted>
      <ErrorText error={list.error ?? done.error} />
      {list.data?.length === 0 && <Empty icon="hourglass-outline" text="В этот день никто не ждёт" />}
      {list.data?.map((w) => (
        <Card key={w.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: C.text, flex: 1 }}>{w.name}</Text>
            {w.status === 'NOTIFIED' && <Text style={{ fontSize: 12, color: '#0F6B48', backgroundColor: '#DDF5EA', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' }}>сообщили об окне</Text>}
          </View>
          <Muted>{w.services.join(', ')}{w.resourceId ? ` · ${resources.data?.find((r) => r.id === w.resourceId)?.name ?? 'мастер'}` : ' · любой мастер'}</Muted>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            {!w.phone.includes('*') && (
              <Pressable onPress={() => Linking.openURL(`tel:${w.phone}`)} style={pill(true)}>
                <Ionicons name="call-outline" size={16} color="#fff" /><Text style={{ color: '#fff', fontWeight: '600' }}>{w.phone}</Text>
              </Pressable>
            )}
            <Pressable onPress={() => done.mutate({ id: w.id, status: 'DONE' })} style={pill(false)}><Text style={{ fontWeight: '600', color: C.text }}>Записали</Text></Pressable>
            <Pressable onPress={() => done.mutate({ id: w.id, status: 'CANCELLED' })} style={pill(false)}><Text style={{ color: C.muted }}>Уже не ждёт</Text></Pressable>
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const pill = (primary: boolean) => ({
  flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
  backgroundColor: primary ? C.brand : C.card, borderWidth: primary ? 0 : 1, borderColor: C.border,
});
