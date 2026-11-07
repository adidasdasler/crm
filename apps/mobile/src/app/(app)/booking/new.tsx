import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, View } from 'react-native';
import { Text } from '../../../components/Text';
import { Button, C, Card, Chip, ErrorText, Field, H, Muted, Screen } from '../../../components/ui';
import { ApiError, get, post } from '../../../lib/api';
import { can, useMe } from '../../../lib/auth';
import { addDays, dayLabel, minutes, phonePretty, rub, time, today, zonedToIso } from '../../../lib/format';
import type { Customer, Resource, Service } from '../../../lib/types';

type Slots = { resourceId: string; name: string; slots: string[] }[];

export default function NewBooking() {
  const me = useMe();
  const tz = me.tenant.timezone;
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ day?: string; resourceId?: string; customerId?: string }>();

  const [q, setQ] = useState('');
  const [customer, setCustomer] = useState<Pick<Customer, 'id' | 'name' | 'phone'> | null>(null);
  const [newCustomer, setNewCustomer] = useState<{ name: string; phone: string } | null>(null);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [resourceId, setResourceId] = useState<string | null>(!can(me, 'bookings.all') ? me.resourceId : params.resourceId || null);
  const [day, setDay] = useState(params.day || today(tz));
  const [slot, setSlot] = useState<string | null>(null);
  const [manualTime, setManualTime] = useState('');
  const [notes, setNotes] = useState('');

  const services = useQuery({ queryKey: ['services'], queryFn: () => get<Service[]>('/services') });
  // Всегда свежие данные: связи мастер↔услуга могли измениться на другом экране.
  const resources = useQuery({ queryKey: ['resources'], queryFn: () => get<Resource[]>('/resources'), staleTime: 0 });
  const found = useQuery({
    queryKey: ['customers', 'search', q],
    queryFn: () => get<Customer[]>(`/customers?limit=6&q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2 && !customer,
  });
  useEffect(() => {
    if (params.customerId) get<Customer>(`/customers/${params.customerId}`).then(setCustomer).catch(() => null);
  }, [params.customerId]);

  const activeServices = (services.data ?? []).filter((s) => s.isActive);
  const selected = activeServices.filter((s) => serviceIds.includes(s.id));
  const total = selected.reduce((a, s) => ({ price: a.price + s.price, duration: a.duration + s.duration }), { price: 0, duration: 0 });
  /** Мастера, которые делают все выбранные услуги */
  const masters = useMemo(
    () => (resources.data ?? []).filter((r) => serviceIds.every((id) => r.serviceIds.includes(id))),
    [resources.data, serviceIds],
  );
  useEffect(() => {
    if (resourceId && serviceIds.length && !masters.some((m) => m.id === resourceId) && can(me, 'bookings.all')) setResourceId(null);
  }, [masters, resourceId, serviceIds.length, me]);

  const slots = useQuery({
    queryKey: ['slots', day, serviceIds, resourceId],
    queryFn: () => get<Slots>(`/bookings/slots?date=${day}&serviceIds=${serviceIds.join(',')}${resourceId ? `&resourceId=${resourceId}` : ''}`),
    enabled: serviceIds.length > 0,
  });
  const times = useMemo(() => [...new Set((slots.data ?? []).flatMap((r) => r.slots))].sort(), [slots.data]);
  useEffect(() => setSlot(null), [day, serviceIds, resourceId]);

  const manualIso = /^\d{1,2}:\d{2}$/.test(manualTime) ? zonedToIso(day, manualTime.padStart(5, '0'), tz) : null;
  const startsAt = slot ?? manualIso;

  const save = useMutation({
    mutationFn: () =>
      post('/bookings', {
        customerId: customer?.id,
        customer: !customer && newCustomer ? newCustomer : undefined,
        resourceId: resourceId ?? (slot ? (slots.data ?? []).find((r) => r.slots.includes(slot))?.resourceId ?? null : null),
        serviceIds,
        startsAt,
        notes: notes || undefined,
        allowOutsideSchedule: !slot,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      router.back();
    },
    onError: (e: ApiError) => {
      if (e.code === 'SLOT_TAKEN') slots.refetch();
      if (Platform.OS !== 'web') Alert.alert('Не удалось записать', e.message);
    },
  });

  const canSave = (customer || (newCustomer && newCustomer.name && newCustomer.phone.replace(/\D/g, '').length >= 10)) && serviceIds.length && startsAt && (resourceId || slot);

  return (
    <Screen>
      <H>Клиент</H>
      {customer ? (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View><Text style={{ fontSize: 16, fontWeight: '600' }}>{customer.name}</Text><Muted>{phonePretty(customer.phone)}</Muted></View>
            <Pressable onPress={() => setCustomer(null)}><Text style={{ color: C.brand, fontWeight: '600' }}>Изменить</Text></Pressable>
          </View>
        </Card>
      ) : newCustomer ? (
        <Card>
          <Field label="Имя" value={newCustomer.name} onChangeText={(name) => setNewCustomer({ ...newCustomer, name })} autoFocus />
          <Field label="Телефон" value={newCustomer.phone} onChangeText={(phone) => setNewCustomer({ ...newCustomer, phone })} keyboardType="phone-pad" />
          <Pressable onPress={() => setNewCustomer(null)}><Text style={{ color: C.brand, fontWeight: '600', paddingTop: 6 }}>Найти в базе</Text></Pressable>
        </Card>
      ) : (
        <>
          <Field value={q} onChangeText={setQ} placeholder="Поиск по имени или телефону" />
          {(found.data ?? []).map((c) => (
            <Card key={c.id} onPress={() => setCustomer(c)}>
              <Text style={{ fontSize: 16, fontWeight: '600' }}>{c.name}</Text>
              <Muted>{phonePretty(c.phone)} · визитов: {c.totalVisits}</Muted>
            </Card>
          ))}
          <Button
            title="Новый клиент"
            icon="person-add-outline"
            variant="ghost"
            onPress={() => setNewCustomer({ name: /\d/.test(q) ? '' : q, phone: /\d/.test(q) ? q : '+7 ' })}
          />
        </>
      )}

      <H>Услуги</H>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {activeServices.map((s) => (
          <Chip key={s.id} label={`${s.name} · ${rub(s.price)}`} active={serviceIds.includes(s.id)} onPress={() => setServiceIds((ids) => (ids.includes(s.id) ? ids.filter((x) => x !== s.id) : [...ids, s.id]))} />
        ))}
      </View>
      {selected.length > 0 && <Muted>Итого: {rub(total.price)} · {minutes(total.duration)}</Muted>}

      {can(me, 'bookings.all') && serviceIds.length > 0 && (
        <>
          <H>Мастер</H>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label="Любой" active={!resourceId} onPress={() => setResourceId(null)} />
            {masters.map((r) => <Chip key={r.id} label={r.name} color={r.color} active={resourceId === r.id} onPress={() => setResourceId(r.id)} />)}
          </View>
          {masters.length === 0 && <Muted>Нет мастера, который делает все выбранные услуги</Muted>}
        </>
      )}

      {serviceIds.length > 0 && (
        <>
          <H>Дата и время</H>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {Array.from({ length: 30 }, (_, i) => addDays(today(tz), i)).map((d) => {
              const l = dayLabel(d);
              const on = d === day;
              return (
                <Pressable key={d} onPress={() => setDay(d)} style={{ width: 48, alignItems: 'center', paddingVertical: 8, borderRadius: 24, backgroundColor: on ? C.brand : C.card, borderWidth: 1, borderColor: on ? C.brand : C.border }}>
                  <Text style={{ fontSize: 12, color: on ? '#fff' : C.muted }}>{l.wd}</Text>
                  <Text style={{ fontSize: 17, fontWeight: '700', color: on ? '#fff' : C.text }}>{l.n}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {slots.isLoading ? <Muted>Загружаем свободное время…</Muted> : times.length === 0 ? <Muted>Свободных окон нет — можно указать время вручную</Muted> : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {times.map((t) => <Chip key={t} label={time(t, tz)} active={slot === t} tone="accent" onPress={() => { setSlot(t); setManualTime(''); }} />)}
            </View>
          )}
          {resourceId && (
            <Field label="Или своё время (вне сетки/графика)" value={manualTime} onChangeText={(v) => { setManualTime(v); setSlot(null); }} placeholder="например 21:30" keyboardType="numbers-and-punctuation" />
          )}
        </>
      )}

      <Field label="Комментарий" value={notes} onChangeText={setNotes} multiline placeholder="Пожелания к визиту" />
      <ErrorText error={save.error} />
      <Button title={startsAt ? `Записать на ${time(startsAt, tz)}` : 'Записать'} onPress={() => save.mutate()} loading={save.isPending} disabled={!canSave} />
    </Screen>
  );
}
