import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Linking, Platform, View } from 'react-native';
import { F, Text } from '../../../components/Text';
import { Button, C, Card, ErrorText, Loading, Muted, Row, Screen } from '../../../components/ui';
import { ApiError, get, post } from '../../../lib/api';
import { useMe } from '../../../lib/auth';
import { dateTitle, isoDay, minutes, phonePretty, rub, STATUS, time } from '../../../lib/format';
import type { Booking, BookingStatus } from '../../../lib/types';

const ACTIONS: Partial<Record<BookingStatus, { to: BookingStatus; title: string; variant?: 'primary' | 'ghost' | 'danger' }[]>> = {
  SCHEDULED: [{ to: 'CONFIRMED', title: 'Клиент подтвердил' }, { to: 'ARRIVED', title: 'Клиент пришёл', variant: 'ghost' }],
  CONFIRMED: [{ to: 'ARRIVED', title: 'Клиент пришёл' }],
  ARRIVED: [{ to: 'COMPLETED', title: 'Завершить визит' }],
  CANCELLED: [{ to: 'SCHEDULED', title: 'Восстановить запись', variant: 'ghost' }],
  NO_SHOW: [{ to: 'SCHEDULED', title: 'Вернуть в расписание', variant: 'ghost' }],
};

export default function BookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tz = useMe().tenant.timezone;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['booking', id], queryFn: () => get<Booking>(`/bookings/${id}`) });

  const status = useMutation({
    mutationFn: (to: BookingStatus) => post<Booking>(`/bookings/${id}/status`, { status: to, version: q.data?.version }),
    onSuccess: (b) => {
      qc.setQueryData(['booking', id], b);
      qc.invalidateQueries({ queryKey: ['bookings'] });
    },
    onError: (e: ApiError) => { if (e.code === 'BOOKING_VERSION_MISMATCH') q.refetch(); },
  });

  if (!q.data) return q.error ? <Screen><ErrorText error={q.error} /></Screen> : <Loading />;
  const b = q.data;
  const st = STATUS[b.status];
  const open = ['SCHEDULED', 'CONFIRMED', 'ARRIVED'].includes(b.status);

  const confirmThen = (title: string, to: BookingStatus) => {
    if (Platform.OS === 'web') { if (confirm(title)) status.mutate(to); return; }
    Alert.alert(title, undefined, [{ text: 'Нет', style: 'cancel' }, { text: 'Да', style: 'destructive', onPress: () => status.mutate(to) }]);
  };

  return (
    <Screen>
      <Card>
        <Text style={{ fontSize: 26, fontFamily: F.display, color: C.text }}>{dateTitle(b.startsAt, tz)}</Text>
        <Muted>до {time(b.endsAt, tz)} · мастер {b.resource.name}</Muted>
        <Text style={{ alignSelf: 'flex-start', marginTop: 6, fontWeight: '600', color: st.color, backgroundColor: st.bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' }}>{st.label}</Text>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <Row icon="person-outline" title={b.customer.name} subtitle={`${phonePretty(b.customer.phone)} · визитов: ${b.customer.totalVisits}`} onPress={() => router.push(`/customer/${b.customer.id}`)} />
      </Card>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button style={{ flex: 1 }} variant="ghost" icon="call-outline" title="Позвонить" onPress={() => Linking.openURL(`tel:${b.customer.phone}`)} />
        <Button style={{ flex: 1 }} variant="ghost" icon="chatbubble-outline" title="Написать" onPress={() => Linking.openURL(`https://t.me/${b.customer.phone}`)} />
      </View>

      <Card>
        {b.items.map((i) => (
          <View key={i.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 15, flex: 1 }}>{i.name} <Text style={{ color: C.muted }}>· {minutes(i.duration)}</Text></Text>
            <Text style={{ fontSize: 15 }}>{rub(i.price)}</Text>
          </View>
        ))}
        <View style={{ height: 1, backgroundColor: C.border, marginVertical: 4 }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 16, fontWeight: '700' }}>Итого</Text>
          <Text style={{ fontSize: 16, fontWeight: '700' }}>{rub(b.price)}</Text>
        </View>
      </Card>
      {(b.notes || b.customer.notes) && (
        <Card>
          {b.notes && <Text><Text style={{ fontWeight: '600' }}>Комментарий: </Text>{b.notes}</Text>}
          {b.customer.notes && <Muted>О клиенте: {b.customer.notes}</Muted>}
        </Card>
      )}
      {b.source === 'WIDGET' && <Muted>Клиент записался онлайн</Muted>}
      {(b.reminders?.length ?? 0) > 0 && (
        <Card>
          <Text style={{ fontWeight: '600' }}>Напоминания клиенту</Text>
          {b.reminders!.map((r) => (
            <Muted key={r.id}>
              {r.type === 'BEFORE_24H' ? 'За сутки' : r.type === 'BEFORE_2H' ? 'За 2 часа' : 'После визита'}:{' '}
              {r.status === 'SENT' ? `отправлено (${r.channel === 'TELEGRAM' ? 'Telegram' : 'SMS'})` : r.status === 'PENDING' ? `в ${time(r.scheduledAt, tz)}${isoDay(new Date(r.scheduledAt), tz) !== isoDay(new Date(b.startsAt), tz) ? ' накануне' : ''}` : r.status === 'CANCELLED' ? 'не нужно' : 'не доставлено'}
            </Muted>
          ))}
        </Card>
      )}

      <ErrorText error={status.error} />
      {(ACTIONS[b.status] ?? []).map((a) => (
        <Button key={a.to} title={a.title} variant={a.variant} loading={status.isPending && status.variables === a.to} onPress={() => status.mutate(a.to)} />
      ))}
      {open && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button style={{ flex: 1 }} variant="ghost" title="Не пришёл" onPress={() => confirmThen('Отметить неявку?', 'NO_SHOW')} />
          <Button style={{ flex: 1 }} variant="danger" title="Отменить" onPress={() => confirmThen('Отменить запись?', 'CANCELLED')} />
        </View>
      )}
    </Screen>
  );
}
