import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';
import { F, Text } from '../../components/Text';
import { Button, C, Card, Chip, ErrorText, H, Loading, Muted, Screen } from '../../components/ui';
import { APP_WEB_URL, get, post } from '../../lib/api';
import { useMe } from '../../lib/auth';
import { rub } from '../../lib/format';
import type { Payment, Plan, Subscription } from '../../lib/types';

const STATUS: Record<Subscription['status'], { text: string; color: string }> = {
  TRIAL: { text: 'Пробный период', color: C.brand },
  ACTIVE: { text: 'Оплачена', color: C.success },
  PAST_DUE: { text: 'Не оплачена — льготные дни', color: '#c2410c' },
  CANCELLED: { text: 'Отменена', color: C.danger },
  EXPIRED: { text: 'Закончилась — только просмотр', color: C.danger },
};
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');

/**
 * Подписка: оплата по ссылке за месяц или год, без автосписаний.
 * На iOS кнопки оплаты нет (правила App Store для цифровых подписок) — оплата в веб-версии.
 */
export default function Billing() {
  const me = useMe();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ payment?: string }>();
  const sub = useQuery({ queryKey: ['subscription'], queryFn: () => get<Subscription>('/billing/subscription') });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => get<Plan[]>('/billing/plans') });
  const history = useQuery({ queryKey: ['payments'], queryFn: () => get<Payment[]>('/billing/payments'), enabled: me.role === 'OWNER' });
  const [planCode, setPlanCode] = useState<string | null>(null);
  const [period, setPeriod] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');
  const [waiting, setWaiting] = useState<string | null>(params.payment ?? null);

  useEffect(() => { if (sub.data && !planCode) setPlanCode(sub.data.plan.code); }, [sub.data, planCode]);

  // Ждём подтверждения оплаты (вебхук или опрос провайдера) — до 5 минут.
  const paid = useQuery({
    queryKey: ['payment', waiting],
    queryFn: () => get<Payment>(`/billing/payments/${waiting}`),
    enabled: !!waiting && me.role === 'OWNER',
    refetchInterval: (q) => (q.state.data?.status === 'PENDING' && q.state.dataUpdateCount < 100 ? 3000 : false),
  });
  useEffect(() => {
    if (paid.data?.status === 'SUCCEEDED') {
      qc.invalidateQueries({ queryKey: ['subscription'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
    }
  }, [paid.data?.status, qc]);

  const pay = useMutation({
    mutationFn: () => post<{ paymentId: string; confirmationUrl: string }>('/billing/pay', { planCode, period }),
    onSuccess: (r) => {
      setWaiting(r.paymentId);
      if (Platform.OS === 'web') window.location.href = r.confirmationUrl;
      else Linking.openURL(r.confirmationUrl);
    },
  });

  if (!sub.data || !plans.data) return sub.error ? <Screen><ErrorText error={sub.error} /></Screen> : <Loading />;
  const s = sub.data;
  const st = STATUS[s.status];
  const plan = plans.data.find((p) => p.code === planCode) ?? s.plan;
  const price = period === 'YEARLY' ? plan.priceYearly : plan.priceMonthly;
  const saving = plan.priceMonthly * 12 - plan.priceYearly;

  return (
    <Screen>
      <Card>
        <Text style={{ fontSize: 13, fontWeight: '700', color: st.color }}>{st.text.toUpperCase()}</Text>
        <Text style={{ fontSize: 28, fontFamily: F.display, color: C.text }}>Тариф «{s.plan.name}»</Text>
        <Muted>
          {s.status === 'TRIAL' ? 'Бесплатно до ' : s.status === 'ACTIVE' ? 'Оплачено до ' : 'Срок закончился '}
          {fmt(s.until)}{s.daysLeft !== null && s.status !== 'EXPIRED' ? ` · осталось дней: ${s.daysLeft}` : ''}
        </Muted>
        {s.status === 'EXPIRED' && <Muted>Данные сохранены. После оплаты всё снова заработает, включая онлайн-запись.</Muted>}
      </Card>

      {paid.data?.status === 'SUCCEEDED' && (
        <Card style={{ backgroundColor: '#d1fae5', borderColor: '#d1fae5' }}>
          <Text style={{ fontWeight: '700', color: '#065f46' }}>✓ Оплата получена — спасибо!</Text>
        </Card>
      )}
      {paid.data?.status === 'PENDING' && <Muted>Ожидаем подтверждение оплаты…</Muted>}

      {me.role !== 'OWNER' ? (
        <Muted>Оплачивает подписку владелец салона.</Muted>
      ) : (
        <>
          <H>Продлить</H>
          {plans.data.map((p) => (
            <Pressable key={p.code} onPress={() => setPlanCode(p.code)}>
              <Card style={{ borderWidth: 2, borderColor: p.code === planCode ? C.brand : '#f1f5f9' }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 17, fontWeight: '700' }}>{p.name}</Text>
                  <Text style={{ fontSize: 17, fontWeight: '700' }}>{rub(p.priceMonthly)}<Text style={{ fontWeight: '400', color: C.muted }}> / мес</Text></Text>
                </View>
                <Muted>До {p.limits.masters} мастеров · {p.limits.smsPerMonth} SMS в месяц · Telegram-напоминания без ограничений</Muted>
              </Card>
            </Pressable>
          ))}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip label="Месяц" active={period === 'MONTHLY'} onPress={() => setPeriod('MONTHLY')} />
            <Chip label={`Год${saving > 0 ? ` · выгода ${rub(saving)}` : ''}`} active={period === 'YEARLY'} onPress={() => setPeriod('YEARLY')} />
          </View>

          {Platform.OS === 'ios' ? (
            <Card>
              <Text style={{ fontWeight: '600' }}>Оплата — в веб-версии</Text>
              <Muted>Откройте {APP_WEB_URL.replace(/^https?:\/\//, '')} на компьютере или в браузере телефона → «Ещё» → «Подписка».</Muted>
            </Card>
          ) : !s.paymentsEnabled ? (
            <Muted>Онлайн-оплата скоро появится. Пока напишите в поддержку — выставим счёт.</Muted>
          ) : (
            <>
              <ErrorText error={pay.error} />
              <Button title={`Оплатить ${rub(price)}`} onPress={() => pay.mutate()} loading={pay.isPending} disabled={!planCode} />
              <Muted>Без автосписаний: каждый период вы оплачиваете сами, мы напомним заранее. Чек придёт из «Мой налог».</Muted>
            </>
          )}

          {(history.data?.filter((p) => p.status === 'SUCCEEDED').length ?? 0) > 0 && (
            <>
              <H>История оплат</H>
              {history.data!.filter((p) => p.status === 'SUCCEEDED').map((p) => (
                <Card key={p.id}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text>{fmt(p.paidAt)} · {p.billingPeriod === 'YEARLY' ? 'год' : 'месяц'}</Text>
                    <Text style={{ fontWeight: '600' }}>{rub(p.amount)}</Text>
                  </View>
                </Card>
              ))}
            </>
          )}
        </>
      )}
    </Screen>
  );
}
