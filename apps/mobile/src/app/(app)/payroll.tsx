import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';
import { Text } from '../../components/Text';
import { Button, C, Card, Chip, ErrorText, Loading, Muted, s, Screen, Toggle } from '../../components/ui';
import { get, put } from '../../lib/api';
import { can, useMe } from '../../lib/auth';
import { addDays, rub, today } from '../../lib/format';

type Rule = { percent: number; perShift: number; monthly: number; deductMaterials: boolean };
type Row = {
  resourceId: string; name: string; color: string; rule: Rule; visits: number; revenue: number; materials: number; shifts: number;
  fromPercent: number; fromShifts: number; fromMonthly: number; total: number;
};
type Report = { from: string; to: string; days: number; masters: Row[]; total: number };

/** Зарплата мастеров за период: процент от услуг, оплата за смену, оклад */
export default function Payroll() {
  const me = useMe();
  const manager = can(me, 'finance.manage');
  const t = today(me.tenant.timezone);
  const periods = useMemo(() => {
    const monthStart = `${t.slice(0, 8)}01`;
    const prevEnd = addDays(monthStart, -1);
    return [
      { key: 'month', label: 'Этот месяц', from: monthStart, to: t },
      { key: 'prev', label: 'Прошлый месяц', from: `${prevEnd.slice(0, 8)}01`, to: prevEnd },
      { key: '2w', label: '2 недели', from: addDays(t, -13), to: t },
    ];
  }, [t]);
  const [period, setPeriod] = useState(periods[0]);
  const report = useQuery({ queryKey: ['payroll', period.from, period.to], queryFn: () => get<Report>(`/payroll?from=${period.from}&to=${period.to}`) });
  const [editing, setEditing] = useState<string | null>(null);

  if (report.isLoading) return <Loading />;
  return (
    <Screen>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {periods.map((p) => <Chip key={p.key} label={p.label} active={period.key === p.key} onPress={() => setPeriod(p)} />)}
      </View>
      <ErrorText error={report.error} />
      {report.data && manager && report.data.masters.length > 1 && (
        <Card>
          <Muted>К выплате всем мастерам за {report.data.days} дн.</Muted>
          <Text style={{ fontSize: 28, fontWeight: '800', color: C.text }}>{rub(report.data.total)}</Text>
        </Card>
      )}
      {report.data?.masters.map((m) => (
        <Card key={m.resourceId}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: m.color }} />
            <Text style={{ fontSize: 17, fontWeight: '700', color: C.text, flex: 1 }}>{m.name}</Text>
            <Text style={{ fontSize: 20, fontWeight: '800', color: C.text }}>{rub(m.total)}</Text>
          </View>
          <Muted>{m.visits} {plural(m.visits, 'визит', 'визита', 'визитов')} на {rub(m.revenue)} · смен: {m.shifts}{m.materials ? ` · материалы ${rub(m.materials)}` : ''}</Muted>
          {m.fromPercent > 0 && <Line label={`${m.rule.percent}% от услуг${m.rule.deductMaterials ? ' (без материалов)' : ''}`} value={m.fromPercent} />}
          {m.fromShifts > 0 && <Line label={`${m.shifts} × ${rub(m.rule.perShift)} за смену`} value={m.fromShifts} />}
          {m.fromMonthly > 0 && <Line label={`Оклад ${rub(m.rule.monthly)}/мес за ${report.data!.days} дн.`} value={m.fromMonthly} />}
          {!m.rule.percent && !m.rule.perShift && !m.rule.monthly && <Muted>Правило оплаты не задано{manager ? ' — нажмите «Настроить оплату»' : ' — спросите у руководителя'}.</Muted>}
          {manager && editing !== m.resourceId && (
            <Text style={{ color: C.brand, fontWeight: '600', marginTop: 4 }} onPress={() => setEditing(m.resourceId)}>Настроить оплату</Text>
          )}
          {editing === m.resourceId && <RuleForm row={m} onDone={() => setEditing(null)} />}
        </Card>
      ))}
      <Muted>Считаются только завершённые визиты по их итоговой цене. Смена — день, в который у мастера были завершённые визиты. Оклад за период считается пропорционально дням (месяц = 30 дней).</Muted>
    </Screen>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: C.muted }}>{label}</Text>
      <Text style={{ color: C.text, fontWeight: '600' }}>{rub(value)}</Text>
    </View>
  );
}

function RuleForm({ row, onDone }: { row: Row; onDone: () => void }) {
  const qc = useQueryClient();
  const [percent, setPercent] = useState(String(row.rule.percent || ''));
  const [perShift, setPerShift] = useState(row.rule.perShift ? String(row.rule.perShift / 100) : '');
  const [monthly, setMonthly] = useState(row.rule.monthly ? String(row.rule.monthly / 100) : '');
  const [deduct, setDeduct] = useState(row.rule.deductMaterials);
  const num = (v: string) => Math.max(0, parseFloat(v.replace(',', '.').replace(/[^\d.]/g, '')) || 0);
  const save = useMutation({
    mutationFn: () => put(`/payroll/rules/${row.resourceId}`, {
      percent: Math.min(100, num(percent)), perShift: Math.round(num(perShift) * 100), monthly: Math.round(num(monthly) * 100), deductMaterials: deduct,
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['payroll'] }); onDone(); },
  });
  const input = (label: string, value: string, set: (v: string) => void, suffix: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={{ flex: 1, color: C.text }}>{label}</Text>
      <TextInput value={value} onChangeText={set} keyboardType="decimal-pad" placeholder="0" style={[s.input, { width: 110, paddingVertical: 8, textAlign: 'right' }]} />
      <Text style={{ width: 28, color: C.muted }}>{suffix}</Text>
    </View>
  );
  return (
    <View style={{ gap: 10, marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderColor: C.border }}>
      {input('Процент от услуг', percent, setPercent, '%')}
      {input('За смену', perShift, setPerShift, '₽')}
      {input('Оклад в месяц', monthly, setMonthly, '₽')}
      <Toggle label="Сначала вычесть материалы" hint="Процент считается от цены услуг минус себестоимость расходников со склада" value={deduct} onChange={setDeduct} />
      <ErrorText error={save.error} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Button title="Сохранить" onPress={() => save.mutate()} loading={save.isPending} /></View>
        <View style={{ flex: 1 }}><Button title="Отмена" variant="ghost" onPress={onDone} /></View>
      </View>
    </View>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}
