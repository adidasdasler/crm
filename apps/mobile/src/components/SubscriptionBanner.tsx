import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable } from 'react-native';
import { Text } from './Text';
import { get } from '../lib/api';
import { useMe } from '../lib/auth';
import type { Subscription } from '../lib/types';

/** Предупреждение о сроке подписки над календарём. */
export function SubscriptionBanner() {
  const me = useMe();
  const sub = useQuery({ queryKey: ['subscription'], queryFn: () => get<Subscription>('/billing/subscription'), refetchInterval: 10 * 60_000 });
  const s = sub.data;
  if (!s) return null;
  const soon = (s.status === 'TRIAL' || s.status === 'ACTIVE') && s.daysLeft !== null && s.daysLeft <= 3;
  if (!soon && s.status !== 'PAST_DUE' && s.status !== 'EXPIRED') return null;

  const owner = me.role === 'OWNER';
  const text =
    s.status === 'EXPIRED'
      ? owner ? 'Подписка закончилась: доступен только просмотр. Оплатить →' : 'Подписка салона закончилась — обратитесь к владельцу'
      : s.status === 'PAST_DUE'
        ? owner ? 'Подписка не оплачена — скоро доступ будет ограничен. Оплатить →' : 'Подписка салона не оплачена'
        : `${s.status === 'TRIAL' ? 'Пробный период' : 'Подписка'} заканчивается через ${s.daysLeft} дн.${owner ? ' Продлить →' : ''}`;
  const danger = s.status !== 'TRIAL' && s.status !== 'ACTIVE';
  return (
    <Pressable onPress={owner ? () => router.push('/billing') : undefined} style={{ backgroundColor: danger ? '#fee2e2' : '#fef3c7', paddingHorizontal: 16, paddingVertical: 10 }}>
      <Text style={{ color: danger ? '#991b1b' : '#92400e', fontWeight: '600' }}>{text}</Text>
    </Pressable>
  );
}
