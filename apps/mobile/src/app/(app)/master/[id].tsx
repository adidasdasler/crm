import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Switch, TextInput, View } from 'react-native';
import { Text } from '../../../components/Text';
import { Button, C, Chip, ErrorText, Field, H, Loading, Muted, Screen, s, Toggle } from '../../../components/ui';
import { MasterPhotoEditor } from '../../../components/MasterPhoto';
import { del, get, patch, post } from '../../../lib/api';
import { can, useMe } from '../../../lib/auth';
import { ScheduleEditor, scheduleValid } from '../../../components/ScheduleEditor';
import { today } from '../../../lib/format';
import { DEFAULT_WEEK, normalize, pruneOverrides, type Schedule } from '../../../lib/schedule';
import type { Resource, Service } from '../../../lib/types';

/** Цвета мастеров: ультрамарин бренда первым, остальные различимы между собой и по светлоте */
export const COLORS = ['#2F3BFF', '#FF6F91', '#00A884', '#FF9F1C', '#7B61FF', '#0EA5E9', '#B5179E', '#5A5E7E'];

export default function MasterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const me = useMe();
  const editable = can(me, 'staff.manage');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['resource', id], queryFn: () => get<Resource>(`/resources/${id}`), enabled: !isNew });
  const services = useQuery({ queryKey: ['services'], queryFn: () => get<Service[]>('/services'), enabled: editable });
  const [f, setF] = useState({ name: '', position: '', phone: '', color: COLORS[0], isActive: true, schedule: normalize(DEFAULT_WEEK) as Schedule, serviceIds: [] as string[] });

  useEffect(() => {
    if (q.data) setF({ name: q.data.name, position: q.data.position ?? '', phone: q.data.phone ?? '', color: q.data.color, isActive: q.data.isActive, schedule: normalize(q.data.schedule as Schedule), serviceIds: q.data.serviceIds });
  }, [q.data]);

  const done = () => { qc.invalidateQueries({ queryKey: ['resources'] }); qc.invalidateQueries({ queryKey: ['resource', id] }); qc.invalidateQueries({ queryKey: ['services'] }); router.back(); };
  const save = useMutation({
    mutationFn: () => {
      const n = normalize(f.schedule);
      const schedule = { ...n, overrides: pruneOverrides(n.overrides, today(me.tenant.timezone)) };
      const body = { name: f.name, position: f.position || null, phone: f.phone || null, color: f.color, isActive: f.isActive, schedule, serviceIds: f.serviceIds };
      return isNew ? post('/resources', body) : patch(`/resources/${id}`, body);
    },
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: () => del(`/resources/${id}`), onSuccess: done });

  if (!isNew && !q.data) return q.error ? <Screen><ErrorText error={q.error} /></Screen> : <Loading />;

  const valid = scheduleValid(f.schedule);

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? 'Новый мастер' : f.name || 'Мастер' }} />
      {!isNew && (editable || me.resourceId === id) && <MasterPhotoEditor id={id} url={q.data?.photoUrl} name={f.name || 'Мастер'} color={f.color} own={me.resourceId === id} consentAt={q.data?.photoConsentAt} />}
      {editable && (
        <>
          <Field label="Имя" value={f.name} onChangeText={(name) => setF({ ...f, name })} />
          <Field label="Должность" value={f.position} onChangeText={(position) => setF({ ...f, position })} placeholder="Мастер маникюра" />
          <Field label="Телефон" value={f.phone} onChangeText={(phone) => setF({ ...f, phone })} keyboardType="phone-pad" />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {COLORS.map((c) => (
              <Pressable key={c} onPress={() => setF({ ...f, color: c })} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c, borderWidth: 3, borderColor: f.color === c ? C.text : 'transparent' }} />
            ))}
          </View>
        </>
      )}

      <H>График работы</H>
      <ScheduleEditor value={f.schedule} onChange={(schedule) => setF({ ...f, schedule })} tz={me.tenant.timezone} editable={editable} />
      {!valid && <Muted>Проверьте время: формат ЧЧ:ММ, начало раньше конца</Muted>}

      {editable && (
        <>
          <H>Услуги мастера</H>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(services.data ?? []).map((sv) => (
              <Chip key={sv.id} label={sv.name} active={f.serviceIds.includes(sv.id)}
                onPress={() => setF({ ...f, serviceIds: f.serviceIds.includes(sv.id) ? f.serviceIds.filter((x) => x !== sv.id) : [...f.serviceIds, sv.id] })} />
            ))}
          </View>
          <Toggle label="Работает (принимает записи)" value={f.isActive} onChange={(isActive) => setF({ ...f, isActive })} />
          <ErrorText error={save.error ?? remove.error} />
          <Button title="Сохранить" onPress={() => save.mutate()} loading={save.isPending} disabled={!f.name || !valid} />
          {!isNew && <Button title="Удалить мастера" variant="danger" onPress={() => remove.mutate()} loading={remove.isPending} />}
        </>
      )}
    </Screen>
  );
}
