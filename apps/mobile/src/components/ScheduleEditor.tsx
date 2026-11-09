import { Pressable, Switch, TextInput, View } from 'react-native';
import { addDays, today } from '../lib/format';
import { CycleMode, formatTime, normalize, Ranges, rangesOn, Schedule, validTime, WeekMode } from '../lib/schedule';
import type { Week } from '../lib/types';
import { Text } from './Text';
import { C, Chip, Muted, s } from './ui';

const DAYS: [keyof Week, string][] = [['1', 'Пн'], ['2', 'Вт'], ['3', 'Ср'], ['4', 'Чт'], ['5', 'Пт'], ['6', 'Сб'], ['7', 'Вс']];
const PATTERNS: { on: number; off: number; label: string }[] = [
  { on: 2, off: 2, label: '2/2' }, { on: 1, off: 1, label: '1/1' }, { on: 3, off: 3, label: '3/3' }, { on: 2, off: 1, label: '2/1' }, { on: 1, off: 2, label: '1/2' },
];
const WEEK_PRESETS: { label: string; days: (keyof Week)[] }[] = [
  { label: 'Пн–Пт', days: ['1', '2', '3', '4', '5'] },
  { label: 'Пн–Сб', days: ['1', '2', '3', '4', '5', '6'] },
  { label: 'Каждый день', days: ['1', '2', '3', '4', '5', '6', '7'] },
  { label: 'Вт–Сб', days: ['2', '3', '4', '5', '6'] },
];
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Все времена графика корректны (формат ЧЧ:ММ, начало раньше конца) */
export function scheduleValid(sc: Schedule): boolean {
  const n = normalize(sc);
  const ok = (r: Ranges) => r.every(([a, b]) => validTime(a) && validTime(b) && a < b);
  const base = n.mode === 'cycle' ? n.hours.length > 0 && ok(n.hours) : Object.values(n.week).every((r) => ok(r ?? []));
  return base && Object.values(n.overrides ?? {}).every(ok);
}

/**
 * Редактор графика: по дням недели или сменный (2/2, 1/1, 3/3, свой), часы вводятся цифрами,
 * календарь на 4 недели — нажатие на день делает его выходным или рабочим (отгул, подмена).
 */
export function ScheduleEditor({ value, onChange, tz, editable = true }: { value: Schedule; onChange: (s: Schedule) => void; tz: string; editable?: boolean }) {
  const n = normalize(value);
  const set = (next: WeekMode | CycleMode) => onChange(next);
  const day0 = today(tz);
  const hoursOf = (x: WeekMode | CycleMode): [string, string] =>
    x.mode === 'cycle' ? x.hours[0] ?? ['10:00', '20:00'] : (Object.values(x.week).find((r) => r?.length)?.[0] ?? ['10:00', '20:00']);

  const toWeek = () => set({ mode: 'week', week: n.mode === 'week' ? n.week : Object.fromEntries(DAYS.slice(0, 5).map(([d]) => [d, [hoursOf(n)]])) as Week, overrides: n.overrides });
  const toCycle = (on = 2, off = 2) => set({ mode: 'cycle', start: n.mode === 'cycle' ? n.start : day0, on, off, hours: [hoursOf(n)], overrides: n.overrides });

  // Календарь: 4 недели начиная с понедельника текущей недели
  const wd = new Date(`${day0}T12:00:00Z`).getUTCDay() || 7;
  const start = addDays(day0, -(wd - 1));
  const cells = Array.from({ length: 28 }, (_, i) => addDays(start, i));
  const toggleDay = (d: string) => {
    if (!editable || d < day0) return;
    const overrides = { ...(n.overrides ?? {}) };
    if (Object.prototype.hasOwnProperty.call(overrides, d)) delete overrides[d];
    else overrides[d] = rangesOn({ ...n, overrides: undefined }, d).length ? [] : [hoursOf(n)];
    set({ ...n, overrides: Object.keys(overrides).length ? overrides : undefined });
  };

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip label="По дням недели" active={n.mode === 'week'} onPress={editable ? toWeek : undefined} />
        <Chip label="Сменный (2/2 и др.)" active={n.mode === 'cycle'} onPress={editable ? () => toCycle() : undefined} />
      </View>

      {n.mode === 'cycle' ? (
        <View style={[s.card, { gap: 10 }]}>
          <Muted>Рабочих / выходных подряд</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {PATTERNS.map((p) => <Chip key={p.label} label={p.label} active={n.on === p.on && n.off === p.off} onPress={editable ? () => set({ ...n, on: p.on, off: p.off }) : undefined} />)}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text>Свой:</Text>
            <NumInput value={n.on} onChange={(on) => set({ ...n, on })} editable={editable} />
            <Text>рабочих,</Text>
            <NumInput value={n.off} onChange={(off) => set({ ...n, off })} editable={editable} min={0} />
            <Text>выходных</Text>
          </View>
          <Muted>Первая рабочая смена</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {Array.from({ length: 7 }, (_, i) => addDays(day0, i)).map((d) => (
              <Chip key={d} label={dateLabel(d)} active={n.start === d} onPress={editable ? () => set({ ...n, start: d }) : undefined} />
            ))}
          </View>
          <HoursRow label="Часы смены" value={n.hours[0] ?? ['10:00', '20:00']} editable={editable} onChange={(r) => set({ ...n, hours: [r] })} />
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {editable && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {WEEK_PRESETS.map((p) => (
                <Chip key={p.label} label={p.label} onPress={() => set({ ...n, week: Object.fromEntries(DAYS.map(([d]) => [d, p.days.includes(d) ? [hoursOf(n)] : []])) as Week })} />
              ))}
            </View>
          )}
          {DAYS.map(([d, label]) => {
            const range = n.week[d]?.[0];
            return (
              <View key={d} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 }]}>
                <Switch value={!!range} disabled={!editable} onValueChange={(on) => set({ ...n, week: { ...n.week, [d]: on ? [hoursOf(n)] : [] } })} trackColor={{ true: C.brand, false: C.border }} thumbColor="#FFFFFF" {...({ activeThumbColor: '#FFFFFF' } as object)} />
                <Text style={{ width: 28, fontWeight: '600', color: range ? C.text : C.muted }}>{label}</Text>
                {range ? (
                  <HoursRow value={range} editable={editable} onChange={(r) => set({ ...n, week: { ...n.week, [d]: [r] } })} />
                ) : <Muted>выходной</Muted>}
              </View>
            );
          })}
          {editable && (
            <Text style={{ color: C.brand, fontWeight: '600' }} onPress={() => {
              const h = hoursOf(n);
              set({ ...n, week: Object.fromEntries(DAYS.map(([d]) => [d, n.week[d]?.length ? [h] : []])) as Week });
            }}>Применить часы первого дня ко всем рабочим дням</Text>
          )}
        </View>
      )}

      <View style={[s.card, { gap: 8 }]}>
        <Text style={{ fontWeight: '600' }}>Ближайшие 4 недели</Text>
        <Muted>Нажмите на день, чтобы сделать его выходным или рабочим — например, отгул или подмена. Точка — особый день.</Muted>
        <View style={{ flexDirection: 'row' }}>
          {DAYS.map(([, l]) => <Text key={l} style={{ flex: 1, textAlign: 'center', fontSize: 12, color: C.muted }}>{l}</Text>)}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {cells.map((d) => {
            const work = rangesOn(n, d).length > 0;
            const special = !!n.overrides && Object.prototype.hasOwnProperty.call(n.overrides, d);
            const past = d < day0;
            return (
              <Pressable key={d} onPress={() => toggleDay(d)} disabled={!editable || past} style={{ width: `${100 / 7}%`, padding: 2 }}
                accessibilityRole="button" accessibilityLabel={`${dateLabel(d)}: ${work ? 'рабочий' : 'выходной'}${special ? ', особый день' : ''}`}>
                <View style={{ height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: work ? C.brand : C.brandSoft, opacity: past ? 0.35 : 1, borderWidth: d === day0 ? 2 : 0, borderColor: C.text }}>
                  <Text style={{ color: work ? '#fff' : C.muted, fontWeight: '600' }}>{+d.slice(8)}</Text>
                  {special && <View style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: 3, backgroundColor: C.accent }} />}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const dateLabel = (d: string) => {
  const w = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][new Date(`${d}T12:00:00Z`).getUTCDay()];
  return `${w} ${+d.slice(8)} ${MONTHS[+d.slice(5, 7) - 1]}`;
};

function HoursRow({ label, value, onChange, editable }: { label?: string; value: [string, string]; onChange: (r: [string, string]) => void; editable: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: label ? undefined : 1, justifyContent: label ? 'flex-start' : 'flex-end' }}>
      {label && <Text style={{ marginRight: 4 }}>{label}:</Text>}
      <TimeInput value={value[0]} editable={editable} onChange={(v) => onChange([v, value[1]])} label="Начало" />
      <Text>—</Text>
      <TimeInput value={value[1]} editable={editable} onChange={(v) => onChange([value[0], v])} label="Конец" />
    </View>
  );
}

/** Время цифрами: «1000» превращается в «10:00» — двоеточие ставить не нужно */
function TimeInput({ value, onChange, editable, label }: { value: string; onChange: (v: string) => void; editable: boolean; label: string }) {
  const bad = !validTime(value);
  return (
    <TextInput
      value={value}
      editable={editable}
      onChangeText={(v) => onChange(formatTime(v))}
      selectTextOnFocus
      keyboardType="number-pad"
      maxLength={5}
      accessibilityLabel={label}
      style={[s.input, { width: 86, paddingHorizontal: 8, paddingVertical: 6, textAlign: 'center', borderColor: bad ? C.danger : C.border }]}
    />
  );
}

function NumInput({ value, onChange, editable, min = 1 }: { value: number; onChange: (v: number) => void; editable: boolean; min?: number }) {
  return (
    <TextInput
      value={String(value)}
      editable={editable}
      keyboardType="number-pad"
      maxLength={2}
      selectTextOnFocus
      onChangeText={(v) => { const x = parseInt(v.replace(/\D/g, '') || String(min), 10); onChange(Math.max(min, Math.min(14, x))); }}
      style={[s.input, { width: 48, paddingVertical: 6, textAlign: 'center' }]}
    />
  );
}
