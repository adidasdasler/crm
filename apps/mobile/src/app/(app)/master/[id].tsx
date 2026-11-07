import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Switch, TextInput, View } from 'react-native';
import { Text } from '../../../components/Text';
import { Button, C, Chip, ErrorText, Field, H, Loading, Muted, Screen, s, Toggle } from '../../../components/ui';
import { del, get, patch, post } from '../../../lib/api';
import { can, useMe } from '../../../lib/auth';
import type { Resource, Service, Week } from '../../../lib/types';

const DAYS: [keyof Week, string][] = [['1', 'Понедельник'], ['2', 'Вторник'], ['3', 'Среда'], ['4', 'Четверг'], ['5', 'Пятница'], ['6', 'Суббота'], ['7', 'Воскресенье']];
/** Цвета мастеров: ультрамарин бренда первым, остальные различимы между собой и по светлоте */
export const COLORS = ['#2F3BFF', '#FF6F91', '#00A884', '#FF9F1C', '#7B61FF', '#0EA5E9', '#B5179E', '#5A5E7E'];
const DEFAULT: Week = { '1': [['10:00', '20:00']], '2': [['10:00', '20:00']], '3': [['10:00', '20:00']], '4': [['10:00', '20:00']], '5': [['10:00', '20:00']], '6': [['10:00', '18:00']], '7': [] };
const validTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

export default function MasterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const me = useMe();
  const editable = can(me, 'staff.manage');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['resource', id], queryFn: () => get<Resource>(`/resources/${id}`), enabled: !isNew });
  const services = useQuery({ queryKey: ['services'], queryFn: () => get<Service[]>('/services'), enabled: editable });
  const [f, setF] = useState({ name: '', position: '', phone: '', color: COLORS[0], isActive: true, schedule: DEFAULT, serviceIds: [] as string[] });

  useEffect(() => {
    if (q.data) setF({ name: q.data.name, position: q.data.position ?? '', phone: q.data.phone ?? '', color: q.data.color, isActive: q.data.isActive, schedule: q.data.schedule, serviceIds: q.data.serviceIds });
  }, [q.data]);

  const done = () => { qc.invalidateQueries({ queryKey: ['resources'] }); qc.invalidateQueries({ queryKey: ['resource', id] }); qc.invalidateQueries({ queryKey: ['services'] }); router.back(); };
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name, position: f.position || null, phone: f.phone || null, color: f.color, isActive: f.isActive, schedule: f.schedule, serviceIds: f.serviceIds };
      return isNew ? post('/resources', body) : patch(`/resources/${id}`, body);
    },
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: () => del(`/resources/${id}`), onSuccess: done });

  if (!isNew && !q.data) return q.error ? <Screen><ErrorText error={q.error} /></Screen> : <Loading />;

  const setDay = (d: keyof Week, range: [string, string][] ) => setF({ ...f, schedule: { ...f.schedule, [d]: range } });
  const scheduleValid = DAYS.every(([d]) => (f.schedule[d] ?? []).every(([a, b]) => validTime(a) && validTime(b) && a < b));

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? 'Новый мастер' : f.name || 'Мастер' }} />
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
      {DAYS.map(([d, label]) => {
        const range = f.schedule[d]?.[0];
        return (
          <View key={d} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
            <Switch value={!!range} disabled={!editable} onValueChange={(on) => setDay(d, on ? [['10:00', '20:00']] : [])} trackColor={{ true: C.brand, false: C.border }} />
            <Text style={{ flex: 1, fontSize: 15, color: range ? C.text : C.muted }}>{label}</Text>
            {range ? (
              <>
                <TimeInput value={range[0]} editable={editable} onChange={(v) => setDay(d, [[v, range[1]]])} />
                <Text>—</Text>
                <TimeInput value={range[1]} editable={editable} onChange={(v) => setDay(d, [[range[0], v]])} />
              </>
            ) : <Muted>выходной</Muted>}
          </View>
        );
      })}
      {!scheduleValid && <Muted>Проверьте время: формат ЧЧ:ММ, начало раньше конца</Muted>}

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
          <Button title="Сохранить" onPress={() => save.mutate()} loading={save.isPending} disabled={!f.name || !scheduleValid} />
          {!isNew && <Button title="Удалить мастера" variant="danger" onPress={() => remove.mutate()} loading={remove.isPending} />}
        </>
      )}
    </Screen>
  );
}

function TimeInput({ value, onChange, editable }: { value: string; onChange: (v: string) => void; editable: boolean }) {
  return (
    <TextInput
      value={value}
      editable={editable}
      onChangeText={(v) => onChange(v.replace(/[^\d:]/g, '').slice(0, 5))}
      keyboardType="numbers-and-punctuation"
      style={[s.input, { width: 72, paddingVertical: 6, textAlign: 'center', borderColor: validTime(value) ? C.border : C.danger }]}
    />
  );
}
