import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button, ErrorText, Field, H, Loading, Muted, Screen, Toggle } from '../../components/ui';
import { get, patch } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { Tenant } from '../../lib/types';

export default function SalonSettings() {
  const qc = useQueryClient();
  const { reload } = useAuth();
  const q = useQuery({ queryKey: ['tenant'], queryFn: () => get<Tenant>('/tenant') });
  const [f, setF] = useState<Tenant | null>(null);
  useEffect(() => { if (q.data) setF(q.data); }, [q.data]);

  const save = useMutation({
    mutationFn: () => patch<Tenant>('/tenant', { name: f!.name, phone: f!.phone || null, address: f!.address || null, settings: f!.settings }),
    onSuccess: (t) => { qc.setQueryData(['tenant'], t); reload(); },
  });
  if (!f) return q.error ? <Screen><ErrorText error={q.error} /></Screen> : <Loading />;
  const set = (k: keyof Tenant['settings']) => (v: string | boolean) =>
    setF({ ...f, settings: { ...f.settings, [k]: typeof v === 'string' ? parseInt(v || '0', 10) : v } });

  return (
    <Screen>
      <Field label="Название" value={f.name} onChangeText={(name) => setF({ ...f, name })} />
      <Field label="Телефон салона" value={f.phone ?? ''} onChangeText={(phone) => setF({ ...f, phone })} keyboardType="phone-pad" />
      <Field label="Адрес" value={f.address ?? ''} onChangeText={(address) => setF({ ...f, address })} />
      <Muted>Часовой пояс: {f.timezone}</Muted>

      <H>Реквизиты для согласия клиентов</H>
      <Muted>Салон — оператор персональных данных своих клиентов. Эти данные показываются в согласии на странице онлайн-записи.</Muted>
      <Field label="ИП / организация" value={f.settings.legalName ?? ''} onChangeText={(legalName) => setF({ ...f, settings: { ...f.settings, legalName } })} placeholder="ИП Иванова Анна Сергеевна" />
      <Field label="ИНН" value={f.settings.inn ?? ''} onChangeText={(inn) => setF({ ...f, settings: { ...f.settings, inn: inn.replace(/\D/g, '').slice(0, 12) } })} keyboardType="number-pad" />

      <H>Онлайн-запись</H>
      <Toggle label="Онлайн-запись включена" value={f.settings.onlineBookingEnabled} onChange={set('onlineBookingEnabled')} />
      <Field label="Шаг сетки времени, мин" value={String(f.settings.slotStepMin)} onChangeText={set('slotStepMin')} keyboardType="number-pad" />
      <Field label="Записаться можно не позже чем за, мин" value={String(f.settings.minLeadMin)} onChangeText={set('minLeadMin')} keyboardType="number-pad" />
      <Field label="Запись открыта на, дней вперёд" value={String(f.settings.maxDaysAhead)} onChangeText={set('maxDaysAhead')} keyboardType="number-pad" />
      <Field label="Клиент может отменить не позднее чем за, ч" value={String(f.settings.cancelBeforeHours)} onChangeText={set('cancelBeforeHours')} keyboardType="number-pad" />

      <H>Напоминания</H>
      <Toggle label="Напоминать клиентам" hint="За 24 часа и за 2 часа до визита" value={f.settings.remindersEnabled} onChange={set('remindersEnabled')} />

      <ErrorText error={save.error} />
      <Button title="Сохранить" onPress={() => save.mutate()} loading={save.isPending} />
    </Screen>
  );
}
