import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { F, Text } from '../../../components/Text';
import { SubscriptionBanner } from '../../../components/SubscriptionBanner';
import { C, Chip, Empty, ErrorText, Fab, webMax } from '../../../components/ui';
import { del, get } from '../../../lib/api';
import { confirm } from '../../../lib/confirm';
import { can, useMe } from '../../../lib/auth';
import { addDays, dayLabel, dayTitle, isoDay, rub, STATUS, time, today } from '../../../lib/format';
import type { Booking, Resource, TimeOff } from '../../../lib/types';

type Item = { kind: 'b'; b: Booking; at: string } | { kind: 't'; t: TimeOff; at: string };

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
  const timeOff = useQuery({ queryKey: ['timeoff', day], queryFn: () => get<TimeOff[]>(`/resources/time-off?date=${day}`), refetchInterval: 60_000 });
  const canClose = can(me, 'staff.manage') || !!me.resourceId;
  const openTime = async (t: TimeOff) => {
    if (!can(me, 'staff.manage') && t.resourceId !== me.resourceId) return;
    const name = resources.data?.find((r) => r.id === t.resourceId)?.name;
    if (!(await confirm('Открыть время?', `${time(t.startsAt, tz)}–${time(t.endsAt, tz)}${name ? `, ${name}` : ''}: клиенты снова смогут записаться онлайн.`, 'Открыть'))) return;
    await del(`/resources/${t.resourceId}/time-off/${t.id}`).catch(() => undefined);
    void qc.invalidateQueries({ queryKey: ['timeoff'] });
  };

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
  // Записи и закрытое время — одним списком по времени начала
  const items = useMemo<Item[]>(
    () => [
      ...list.map((b) => ({ kind: 'b' as const, b, at: b.startsAt })),
      ...(timeOff.data ?? []).filter((t) => !resourceId || t.resourceId === resourceId).map((t) => ({ kind: 't' as const, t, at: t.startsAt })),
    ].sort((x, y) => x.at.localeCompare(y.at)),
    [list, timeOff.data, resourceId],
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
        data={items}
        keyExtractor={(x) => (x.kind === 'b' ? x.b.id : `t${x.t.id}`)}
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
        renderItem={({ item: x }) =>
          x.kind === 'b' ? <BookingCard b={x.b} tz={tz} /> : (
            <TimeOffCard t={x.t} tz={tz} day={day} name={resources.data?.find((r) => r.id === x.t.resourceId)?.name} onPress={() => void openTime(x.t)} />
          )}
      />
      {canClose && (
        <Pressable onPress={() => router.push({ pathname: '/timeoff/new', params: { day, resourceId: resourceId ?? me.resourceId ?? '' } })}
          accessibilityRole="button" accessibilityLabel="Закрыть время"
          style={({ pressed }) => ({ position: 'absolute', right: 20, bottom: 92, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 44, borderRadius: 22, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, opacity: pressed ? 0.8 : 1, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 })}>
          <Ionicons name="lock-closed-outline" size={18} color={C.text} />
          <Text style={{ fontWeight: '600', color: C.text }}>Закрыть время</Text>
        </Pressable>
      )}
      <Fab onPress={() => router.push({ pathname: '/booking/new', params: { day, resourceId: resourceId ?? me.resourceId ?? '' } })} />
    </View>
  );
}

/** Закрытое время: серый блок, нажатие — открыть обратно */
function TimeOffCard({ t, tz, day, name, onPress }: { t: TimeOff; tz: string; day: string; name?: string; onPress: () => void }) {
  // Блок на весь день или переходящий через полночь — показываем границы дня
  const from = isoDay(new Date(t.startsAt), tz) < day ? '00:00' : time(t.startsAt, tz);
  const to = isoDay(new Date(t.endsAt), tz) > day ? '24:00' : time(t.endsAt, tz);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Закрыто ${from}–${to}. Нажмите, чтобы открыть`} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#ECEDF3', borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: '#C9CBD9' }}>
        <View style={{ width: 69, paddingVertical: 12, alignItems: 'center' }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: C.muted }}>{from}</Text>
          <Text style={{ fontSize: 13, color: C.muted }}>{to}</Text>
        </View>
        <Ionicons name="lock-closed" size={16} color={C.muted} />
        <View style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 10 }}>
          <Text style={{ fontWeight: '600', color: C.text }}>Закрыто{t.reason ? ` · ${t.reason}` : ''}</Text>
          {name && <Text style={{ fontSize: 13, color: C.muted }}>{name}</Text>}
        </View>
      </View>
    </Pressable>
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
