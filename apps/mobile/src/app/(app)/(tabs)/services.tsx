import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { Button, C, Card, Chip, Empty, ErrorText, Fab, Muted, webMax } from '../../../components/ui';
import { get, post } from '../../../lib/api';
import { minutes, rub } from '../../../lib/format';
import type { Service } from '../../../lib/types';

const TEMPLATES: Record<string, string> = { nails: 'Маникюр', hair: 'Парикмахерская', brows: 'Брови и ресницы', barber: 'Барбершоп' };

export default function Services() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['services'], queryFn: () => get<Service[]>('/services') });
  const fromTemplate = useMutation({
    mutationFn: (template: string) => post('/services/from-template', { template }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['services'] }); qc.invalidateQueries({ queryKey: ['resources'] }); },
  });
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <FlatList
        data={list.data ?? []}
        keyExtractor={(s) => s.id}
        contentContainerStyle={[webMax, { padding: 16, gap: 8, paddingBottom: 100 }]}
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />}
        ListEmptyComponent={
          list.isLoading ? undefined : (
            <View style={{ gap: 12 }}>
              <Empty icon="pricetags-outline" text={'Услуг пока нет.\nДобавьте вручную или из шаблона:'} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                {Object.entries(TEMPLATES).map(([k, v]) => <Chip key={k} label={v} onPress={() => fromTemplate.mutate(k)} />)}
              </View>
              <ErrorText error={fromTemplate.error ?? list.error} />
            </View>
          )
        }
        renderItem={({ item: s }) => (
          <Card onPress={() => router.push(`/service/${s.id}`)} style={{ opacity: s.isActive ? 1 : 0.5 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', flex: 1 }}>{s.name}</Text>
              <Text style={{ fontSize: 16, fontWeight: '600' }}>{rub(s.price)}</Text>
            </View>
            <Muted>{minutes(s.duration)}{s.bufferTime ? ` + ${s.bufferTime} мин перерыв` : ''}{!s.isPublic ? ' · скрыта из онлайн-записи' : ''}</Muted>
          </Card>
        )}
      />
      <Fab onPress={() => router.push('/service/new')} />
    </View>
  );
}
