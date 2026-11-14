import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { Text } from '../../../components/Text';
import { Button, C, Chip, ErrorText, Field, H, Muted, Screen, s } from '../../../components/ui';
import { ApiError, get, post } from '../../../lib/api';
import { can, useMe } from '../../../lib/auth';
import { confirm } from '../../../lib/confirm';
import { addDays, dayLabel, today, zonedToIso } from '../../../lib/format';
import { useOnline } from '../../../lib/offline';
import { finishTime, formatTime, validTime } from '../../../lib/schedule';
import type { Resource } from '../../../lib/types';

const REASONS = ['Перерыв', 'Обед', 'Личное', 'Отгул', 'Учёба'];
const REPEATS: { label: string; days: number }[] = [
  { label: 'Только этот день', days: 0 }, { label: 'Неделю', days: 6 }, { label: '2 недели', days: 13 }, { label: 'Месяц', days: 29 },
];

/** Закрыть время вручную: перерыв, обед, личные дела. Онлайн-запись на это время недоступна. */
export default function NewTimeOff() {
  const me = useMe();
  const online = useOnline();
  const tz = me.tenant.timezone;
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ day?: string; resourceId?: string }>();
  const manager = can(me, 'staff.manage');

  const [resourceId, setResourceId] = useState<string | null>(manager ? params.resourceId || me.resourceId : me.resourceId);
  const [day, setDay] = useState(params.day && params.day >= today(tz) ? params.day : today(tz));
  const [allDay, setAllDay] = useState(false);
  const [from, setFrom] = useState('13:00');
  const [to, setTo] = useState('14:00');
  const [reason, setReason] = useState('Перерыв');
  const [repeat, setRepeat] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const resources = useQuery({ queryKey: ['resources'], queryFn: () => get<Resource[]>('/resources'), enabled: manager });
  const days = Array.from({ length: 21 }, (_, i) => addDays(today(tz), i));
  const timesOk = allDay || (validTime(from) && validTime(to) && from < to);

  const save = useMutation({
    mutationFn: async () => {
      const startsAt = zonedToIso(day, allDay ? '00:00' : from, tz);
      const endsAt = allDay ? zonedToIso(addDays(day, 1), '00:00', tz) : zonedToIso(day, to, tz);
      const body = { startsAt, endsAt, reason: reason.trim() || null, ...(repeat ? { repeatUntil: addDays(day, repeat) } : {}) };
      try {
        return await post<{ created: number }>(`/resources/${resourceId}/time-off`, body);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'BOOKINGS_IN_TIME_OFF') {
          if (!(await confirm('На это время есть записи', `${e.message}. Записи останутся, клиентов нужно предупредить самому.`, 'Закрыть всё равно'))) return null;
          return post<{ created: number }>(`/resources/${resourceId}/time-off`, { ...body, force: true });
        }
        throw e;
      }
    },
    onSuccess: (r) => {
      if (!r) return;
      void qc.invalidateQueries({ queryKey: ['timeoff'] });
      void qc.invalidateQueries({ queryKey: ['slots'] });
      router.back();
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!resourceId && !manager) {
    return <Screen><Muted>Ваш аккаунт не привязан к мастеру — закрывать время может владелец или управляющий.</Muted></Screen>;
  }

  return (
    <Screen>
      <Muted>В закрытое время клиенты не смогут записаться онлайн. Уже существующие записи не отменяются.</Muted>

      {manager && (resources.data?.length ?? 0) > 1 && (
        <>
          <H>Кому</H>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {resources.data!.map((r) => <Chip key={r.id} label={r.name} color={r.color} active={resourceId === r.id} onPress={() => setResourceId(r.id)} />)}
          </View>
        </>
      )}

      <H>День</H>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {days.map((d) => {
          const l = dayLabel(d);
          return <Chip key={d} label={`${l.wd} ${l.n}`} active={d === day} onPress={() => setDay(d)} />;
        })}
      </View>

      <H>Время</H>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip label="Часть дня" active={!allDay} onPress={() => setAllDay(false)} />
        <Chip label="Весь день" active={allDay} onPress={() => setAllDay(true)} />
      </View>
      {!allDay && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text>с</Text>
          <Time value={from} onChange={setFrom} label="Начало" />
          <Text>до</Text>
          <Time value={to} onChange={setTo} label="Конец" />
        </View>
      )}
      {!timesOk && <Text style={{ color: C.danger }}>Укажите время цифрами, например 1300 — 1400. Начало раньше конца.</Text>}

      <H>Причина</H>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {REASONS.map((r) => <Chip key={r} label={r} active={reason === r} onPress={() => setReason(r)} />)}
      </View>
      <Field placeholder="Своя причина — клиенты её не видят" value={REASONS.includes(reason) ? '' : reason} onChangeText={setReason} maxLength={200} />

      <H>Повторять</H>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {REPEATS.map((r) => <Chip key={r.label} label={r.label} active={repeat === r.days} onPress={() => setRepeat(r.days)} />)}
      </View>
      {repeat > 0 && <Muted>Каждый день в это же время, до {dayLabel(addDays(day, repeat)).n}-го включительно. Выходные дни графика не мешают — там и так нельзя записаться.</Muted>}

      {error && <ErrorText error={new Error(error)} />}
      {!online && <Muted>Нет связи — закрыть время можно, когда интернет вернётся.</Muted>}
      <Button title="Закрыть время" onPress={() => { setError(null); save.mutate(); }} loading={save.isPending} disabled={!timesOk || !resourceId || !online} />
    </Screen>
  );
}

function Time({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <TextInput
      value={value}
      onChangeText={(v) => onChange(formatTime(v))}
      onBlur={() => onChange(finishTime(value))}
      placeholder="1300"
      selectTextOnFocus
      keyboardType="number-pad"
      maxLength={5}
      accessibilityLabel={label}
      style={[s.input, { width: 96, textAlign: 'center', borderColor: validTime(value) ? C.border : C.danger }]}
    />
  );
}
