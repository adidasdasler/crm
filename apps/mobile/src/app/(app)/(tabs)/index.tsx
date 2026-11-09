import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { F, Text } from '../../../components/Text';
import { SubscriptionBanner } from '../../../components/SubscriptionBanner';
import { C, Chip, Empty, ErrorText, Fab, webMax } from '../../../components/ui';
import { get } from '../../../lib/api';
import { can, useMe } from '../../../lib/auth';
import { addDays, dayLabel, dayTitle, rub, STATUS, time, today } from '../../../lib/format';
import type { Booking, Resource } from '../../../lib/types';

/** Владелец при запуске приложения сразу попадает на «Сегодня» (один раз за запуск) */
let startRedirectDone = false;

export default function Calendar() {
  const me = useMe();
  useEffect(() => {
    if (startRedirectDone) return;
    startRedirectDone = true;
    if (can(me, 'analytics.view')) router.navigate('/dashboard');
  }, [me]);
  const tz = me.tenant.timezone;
  const [day, setDay] = useState(today(tz));
  const [resourceId, setResourceId] = useState<string | null>(null);

  const resources = useQuery({ queryKey: ['resources'], queryFn: () => get<Resource[]>('/resources'), enabled: can(me, 'bookings.all') });
  const bookings = useQuery({
    queryKey: ['bookings', day],
    queryFn: () => get<Booking[]>(`/bookings?date=${day}`),
    refetchInterval: 30_000, // вместо WebSocket на старте — обновление раз в 30 секунд
  });

  // Пока есть связь — заранее сохраняем ближайшие 3 дня: без интернета расписание будет под рукой
  const qc = useQueryClient();
  useEffect(() => {
    for (let i = 1; i <= 3; i++) {
      const d = addDays(day, i);
      void qc.prefetchQuery({ queryKey: ['bookings', d], queryFn: () => get<Booking[]>(`/bookings?date=${d}`), staleTime: 5 * 60_000 });
    }
  }, [day, qc]);

  const list = useMemo(
    () => (bookings.data ?? []).filter((b) => !resourceId || b.resourceId === resourceId),
    [bookings.data, resourceId],
  );
  const active = list.filter((b) => !['CANCELLED', 'NO_SHOW'].includes(b.status));
  const revenue = active.reduce((s, b) => s + b.price, 0);
  const days = useMemo(() => Array.from({ length: 21 }, (_, i) => addDays(today(tz), i - 3)), [tz]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SubscriptionBanner />
      <View style={{ backgroundColor: C.card, borderBottomWidth: 1, borderColor: C.border }}>
        <View style={webMax}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10, gap: 6 }}>
          {days.map((d) => {
            const l = dayLabel(d);
            const on = d === day;
            return (
              <Pressable key={d} onPress={() => setDay(d)} style={{ width: 46, alignItems: 'center', paddingVertical: 8, borderRadius: 23, backgroundColor: on ? C.brand : 'transparent' }}>
                <Text style={{ fontSize: 12, color: on ? '#fff' : C.muted }}>{l.wd}</Text>
                <Text style={{ fontSize: 18, fontWeight: '700', color: on ? '#fff' : d === today(tz) ? C.brand : C.text }}>{l.n}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {can(me, 'bookings.all') && (resources.data?.length ?? 0) > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 10, gap: 6 }}>
            <Chip label="Все" active={!resourceId} onPress={() => setResourceId(null)} />
            {resources.data!.map((r) => <Chip key={r.id} label={r.name} active={resourceId === r.id} color={r.color} onPress={() => setResourceId(r.id)} />)}
          </ScrollView>
        )}
        </View>
      </View>

      <FlatList
        data={list}
        keyExtractor={(b) => b.id}
        contentContainerStyle={[webMax, { padding: 16, gap: 10, paddingBottom: 100 }]}
        refreshControl={<RefreshControl refreshing={bookings.isRefetching} onRefresh={() => void bookings.refetch()} />}
        ListHeaderComponent={
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
            <Text style={{ fontSize: 24, fontFamily: F.display, color: C.text }}>{dayTitle(day, tz)}</Text>
            {active.length > 0 && <Text style={{ color: C.muted }}>{active.length} зап. · {rub(revenue)}</Text>}
          </View>
        }
        ListEmptyComponent={
          bookings.isLoading ? undefined : bookings.error ? <ErrorText error={bookings.error} /> : <Empty text="На этот день записей нет" />
        }
        renderItem={({ item: b }) => <BookingCard b={b} tz={tz} />}
      />
      <Fab onPress={() => router.push({ pathname: '/booking/new', params: { day, resourceId: resourceId ?? me.resourceId ?? '' } })} />
    </View>
  );
}

function BookingCard({ b, tz }: { b: Booking; tz: string }) {
  const st = STATUS[b.status];
  const dim = ['CANCELLED', 'NO_SHOW'].includes(b.status);
  return (
    <Pressable onPress={() => router.push(`/booking/${b.id}`)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : dim ? 0.55 : 1 })}>
      <View style={{ flexDirection: 'row', backgroundColor: C.card, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: '#EEF0F7' }}>
        <View style={{ width: 5, backgroundColor: b.resource.color }} />
        <View style={{ width: 64, paddingVertical: 12, alignItems: 'center' }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: C.text }}>{time(b.startsAt, tz)}</Text>
          <Text style={{ fontSize: 13, color: C.muted }}>{time(b.endsAt, tz)}</Text>
        </View>
        <View style={{ flex: 1, paddingVertical: 12, paddingRight: 12, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: C.text, flex: 1 }} numberOfLines={1}>{b.customer.name}</Text>
            {b.source === 'WIDGET' && <Ionicons name="globe-outline" size={14} color={C.muted} />}
          </View>
          <Text style={{ color: C.muted }} numberOfLines={1}>{b.items.map((i) => i.name).join(', ')}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: st.color, backgroundColor: st.bg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' }}>{st.label}</Text>
            <Text style={{ fontSize: 13, color: C.muted }}>{b.resource.name} · {rub(b.price)}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}
