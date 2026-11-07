import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { C, Card, Empty, ErrorText, Fab, Field, Muted } from '../../../components/ui';
import { get } from '../../../lib/api';
import { phonePretty, rub } from '../../../lib/format';
import type { Customer } from '../../../lib/types';

export default function Customers() {
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['customers', 'list', q], queryFn: () => get<Customer[]>(`/customers?limit=100&q=${encodeURIComponent(q)}`) });
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <FlatList
        data={list.data ?? []}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 100 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />}
        ListHeaderComponent={<View style={{ marginBottom: 4 }}><Field value={q} onChangeText={setQ} placeholder="Поиск по имени или телефону" /></View>}
        ListEmptyComponent={list.isLoading ? undefined : list.error ? <ErrorText error={list.error} /> : <Empty icon="people-outline" text={q ? 'Никого не нашли' : 'Клиентов пока нет.\nОни появятся после первой записи'} />}
        renderItem={({ item: c }) => (
          <Card onPress={() => router.push(`/customer/${c.id}`)}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 16, fontWeight: '600', flex: 1 }} numberOfLines={1}>{c.name}</Text>
              {c.tags.length > 0 && <Text style={{ color: C.brand, fontSize: 13 }}>{c.tags.join(' · ')}</Text>}
            </View>
            <Muted>{phonePretty(c.phone)} · визитов {c.totalVisits}{c.totalSpent ? ` · ${rub(c.totalSpent)}` : ''}</Muted>
          </Card>
        )}
      />
      <Fab icon="person-add" onPress={() => router.push('/customer/new')} />
    </View>
  );
}
