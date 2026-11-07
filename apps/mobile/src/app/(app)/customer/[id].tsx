import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { Text } from '../../../components/Text';
import { Button, C, Card, ErrorText, Field, H, Loading, Muted, Screen, Toggle } from '../../../components/ui';
import { get, patch, post } from '../../../lib/api';
import { useMe } from '../../../lib/auth';
import { dateTitle, rub, STATUS } from '../../../lib/format';
import type { Booking, Customer } from '../../../lib/types';

type Full = Customer & { bookings: (Booking & { resource: { name: string } })[] };

export default function CustomerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const tz = useMe().tenant.timezone;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['customer', id], queryFn: () => get<Full>(`/customers/${id}`), enabled: !isNew });
  const [f, setF] = useState({ name: '', phone: '+7 ', notes: '', tags: '', marketingConsent: false });
  useEffect(() => {
    if (q.data) setF({ name: q.data.name, phone: q.data.phone, notes: q.data.notes ?? '', tags: q.data.tags.join(', '), marketingConsent: q.data.marketingConsent });
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name, phone: f.phone, notes: f.notes || null, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), marketingConsent: f.marketingConsent };
      return isNew ? post<Customer>('/customers', body) : patch<Customer>(`/customers/${id}`, body);
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer', id] });
      if (isNew) router.replace(`/customer/${c.id}`);
    },
  });

  if (!isNew && !q.data) return q.error ? <Screen><ErrorText error={q.error} /></Screen> : <Loading />;
  const c = q.data;

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? 'Новый клиент' : c!.name }} />
      {c && (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Stat label="Визитов" value={String(c.totalVisits)} />
            <Stat label="Потратил" value={rub(c.totalSpent)} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button style={{ flex: 1 }} variant="ghost" icon="call-outline" title="Позвонить" onPress={() => Linking.openURL(`tel:${c.phone}`)} />
            <Button style={{ flex: 1 }} icon="add" title="Записать" onPress={() => router.push({ pathname: '/booking/new', params: { customerId: c.id } })} />
          </View>
        </>
      )}
      {c && <Muted>{c.telegramChatId ? '🔔 Напоминания приходят в Telegram' : '🔔 Напоминания — по SMS (Telegram клиент не подключил)'}</Muted>}
      <Field label="Имя" value={f.name} onChangeText={(name) => setF({ ...f, name })} />
      <Field label="Телефон" value={f.phone} onChangeText={(phone) => setF({ ...f, phone })} keyboardType="phone-pad" />
      <Field label="Заметки" value={f.notes} onChangeText={(notes) => setF({ ...f, notes })} multiline placeholder="Предпочтения клиента (без сведений о здоровье)" />
      <Field label="Метки через запятую" value={f.tags} onChangeText={(tags) => setF({ ...f, tags })} placeholder="VIP, постоянный" />
      <Toggle label="Согласие на рассылки" hint="Без согласия рекламные сообщения отправлять нельзя" value={f.marketingConsent} onChange={(marketingConsent) => setF({ ...f, marketingConsent })} />
      <ErrorText error={save.error} />
      <Button title="Сохранить" onPress={() => save.mutate()} loading={save.isPending} disabled={!f.name || f.phone.replace(/\D/g, '').length < 10} />

      {c && c.bookings.length > 0 && (
        <>
          <H>История визитов</H>
          {c.bookings.map((b) => (
            <Card key={b.id} onPress={() => router.push(`/booking/${b.id}`)}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '600' }}>{dateTitle(b.startsAt, tz)}</Text>
                <Text style={{ color: STATUS[b.status].color, fontSize: 13 }}>{STATUS[b.status].label}</Text>
              </View>
              <Muted>{b.items.map((i) => i.name).join(', ')} · {b.resource.name} · {rub(b.price)}</Muted>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <Card style={{ flex: 1, alignItems: 'center' }}>
    <Text style={{ fontSize: 22, fontWeight: '700', color: C.text }}>{value}</Text>
    <Muted>{label}</Muted>
  </Card>
);
