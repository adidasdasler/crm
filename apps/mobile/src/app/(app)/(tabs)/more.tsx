import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Alert, Platform, Share, Text, View } from 'react-native';
import { Button, C, Card, Muted, Row, Screen } from '../../../components/ui';
import { get, post, PUBLIC_WEB_URL, tokens } from '../../../lib/api';
import { canManage, useAuth, useMe } from '../../../lib/auth';
import { rub } from '../../../lib/format';
import type { Subscription } from '../../../lib/types';

const SUB_STATUS: Record<string, string> = { TRIAL: 'Пробный период', ACTIVE: 'Активна', PAST_DUE: 'Ожидает оплаты', CANCELLED: 'Отменена', EXPIRED: 'Истекла' };

export default function More() {
  const me = useMe();
  const { logout, reload } = useAuth();
  const qc = useQueryClient();
  const isOwner = me.role === 'OWNER';
  const sub = useQuery({ queryKey: ['subscription'], queryFn: () => get<Subscription>('/billing/subscription'), enabled: isOwner });
  const link = `${PUBLIC_WEB_URL}/b/${me.tenant.slug}`;

  const share = async () => {
    if (Platform.OS === 'web') {
      await navigator.clipboard?.writeText(link);
      alert('Ссылка скопирована');
    } else await Share.share({ message: `Записаться онлайн: ${link}` });
  };
  const switchTenant = (tenantId: string) =>
    post('/auth/switch-tenant', { tenantId }).then(async (t) => { await tokens.save(t as object); qc.clear(); await reload(); router.replace('/'); });

  return (
    <Screen>
      <Card>
        <Text style={{ fontSize: 20, fontWeight: '700' }}>{me.tenant.name}</Text>
        <Muted>{me.user.name} · {me.user.email}</Muted>
      </Card>

      <Card style={{ backgroundColor: C.brandSoft, borderColor: C.brandSoft }}>
        <Text style={{ fontWeight: '700', color: C.brandDark }}>Ссылка для онлайн-записи</Text>
        <Text style={{ color: C.brandDark }} selectable>{link}</Text>
        <Muted>Добавьте её в профиль Instagram, ВКонтакте, Telegram и на Яндекс Карты</Muted>
        <Button title="Поделиться ссылкой" icon="share-outline" onPress={share} style={{ marginTop: 6 }} />
      </Card>

      {sub.data && (
        <Card>
          <Text style={{ fontWeight: '700' }}>Подписка: {sub.data.plan.name} · {SUB_STATUS[sub.data.status] ?? sub.data.status}</Text>
          <Muted>{sub.data.daysLeft !== null ? `Осталось дней: ${sub.data.daysLeft}` : ''} · {rub(sub.data.plan.priceMonthly)}/мес</Muted>
          <Muted>Онлайн-оплата подписки появится в ближайшем обновлении</Muted>
        </Card>
      )}

      <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#f1f5f9' }}>
        {canManage(me.role) && <Row icon="cut-outline" title="Мастера и графики" onPress={() => router.push('/masters')} />}
        {(isOwner || me.role === 'MANAGER') && <Row icon="people-circle-outline" title="Команда и доступы" onPress={() => router.push('/team')} />}
        {(isOwner || me.role === 'MANAGER') && <Row icon="settings-outline" title="Настройки салона" onPress={() => router.push('/salon')} />}
        {me.role === 'MASTER' && me.resourceId && <Row icon="time-outline" title="Мой график" onPress={() => router.push(`/master/${me.resourceId}`)} />}
      </View>

      {me.tenants.length > 1 && (
        <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#f1f5f9' }}>
          {me.tenants.filter((t) => t.id !== me.tenant.id).map((t) => (
            <Row key={t.id} icon="swap-horizontal" title={`Перейти: ${t.name}`} onPress={() => switchTenant(t.id)} />
          ))}
        </View>
      )}

      <Button
        title="Выйти"
        variant="danger"
        onPress={() => (Platform.OS === 'web' ? confirm('Выйти из аккаунта?') && logout() : Alert.alert('Выйти из аккаунта?', undefined, [{ text: 'Отмена', style: 'cancel' }, { text: 'Выйти', style: 'destructive', onPress: logout }]))}
      />
    </Screen>
  );
}
