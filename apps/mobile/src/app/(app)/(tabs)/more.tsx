import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Alert, Linking, Platform, Share, View } from 'react-native';
import { F, Text } from '../../../components/Text';
import { Button, C, Card, Muted, Row, Screen } from '../../../components/ui';
import { API_URL, del, get, post, PUBLIC_WEB_URL, tokens } from '../../../lib/api';
import { can, useAuth, useMe, useTerms } from '../../../lib/auth';
import type { StockAlerts, Subscription } from '../../../lib/types';

const stockHint = (a: StockAlerts) =>
  [a.low.length && `заканчивается: ${a.low.length}`, a.expiring.length && `срок годности: ${a.expiring.length}`].filter(Boolean).join(' · ') || 'Всё в порядке';

const SUB_STATUS: Record<string, string> = { TRIAL: 'Пробный период', ACTIVE: 'Активна', PAST_DUE: 'Ожидает оплаты', CANCELLED: 'Отменена', EXPIRED: 'Истекла' };

export default function More() {
  const me = useMe();
  const { logout, reload } = useAuth();
  const qc = useQueryClient();
  const isOwner = me.role === 'OWNER';
  const terms = useTerms();
  const stockAlerts = useQuery({ queryKey: ['stock', 'alerts'], queryFn: () => get<StockAlerts>('/stock/alerts'), enabled: can(me, 'stock.manage') });
  const sub = useQuery({ queryKey: ['subscription'], queryFn: () => get<Subscription>('/billing/subscription') });
  const toggleTelegram = async () => {
    try {
      if (me.telegramLinked) {
        await del('/me/telegram');
        await reload();
        return;
      }
      const { url } = await post<{ url: string }>('/me/telegram');
      await Linking.openURL(url);
      // Пользователь вернётся из Telegram — обновим статус привязки
      setTimeout(reload, 8000);
    } catch (e) {
      Platform.OS === 'web' ? alert((e as Error).message) : Alert.alert('Telegram', (e as Error).message);
    }
  };
  const link = `${PUBLIC_WEB_URL}/b/${me.tenant.slug}`;

  const share = async () => {
    if (Platform.OS === 'web') {
      await navigator.clipboard?.writeText(link);
      alert('Ссылка скопирована');
    } else await Share.share({ message: `Записаться онлайн: ${link}` });
  };
  /** CSV для Excel: в вебе — скачивание файла, в приложении — «Поделиться» */
  const exportCustomers = async () => {
    try {
      const headers: Record<string, string> = Platform.OS === 'web' ? {} : { Authorization: `Bearer ${await tokens.access()}`, 'X-Client': 'mobile' };
      const res = await fetch(`${API_URL}/tenant/export/customers.csv`, { headers, credentials: 'include' });
      if (!res.ok) throw new Error('Не удалось выгрузить, попробуйте ещё раз');
      const csv = await res.text();
      if (Platform.OS === 'web') {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        a.download = `klienty-${me.tenant.slug}.csv`;
        a.click();
      } else {
        await Share.share({ title: 'Клиенты', message: csv });
      }
    } catch (e) {
      Platform.OS === 'web' ? alert((e as Error).message) : Alert.alert('Выгрузка', (e as Error).message);
    }
  };
  const switchTenant = (tenantId: string) =>
    post('/auth/switch-tenant', { tenantId }).then(async (t) => { await tokens.save(t as object); qc.clear(); await reload(); router.replace('/'); });

  return (
    <Screen>
      <Card>
        <Text style={{ fontSize: 24, fontFamily: F.display }}>{me.tenant.name}</Text>
        <Muted>{me.user.name} · {me.user.email}</Muted>
      </Card>

      <Card style={{ backgroundColor: C.brandSoft, borderColor: C.brandSoft }}>
        <Text style={{ fontWeight: '700', color: C.brandDark }}>Ссылка для онлайн-записи</Text>
        <Text style={{ color: C.brandDark }} selectable>{link}</Text>
        <Muted>Добавьте её в Яндекс Карты, 2ГИС, ВКонтакте и Telegram — клиенты будут записываться сами</Muted>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          <Button title="Поделиться" icon="share-outline" onPress={share} style={{ flexGrow: 1 }} />
          <Button variant="ghost" title="Яндекс Карты и 2ГИС" icon="location-outline" onPress={() => router.push('/maps')} style={{ flexGrow: 1 }} />
        </View>
      </Card>

      <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#f1f5f9' }}>
        {can(me, 'staff.manage') && <Row icon="cut-outline" title={me.solo ? 'Мой график' : `${terms.staffPlural} и графики`} onPress={() => router.push(me.solo && me.resourceId ? `/master/${me.resourceId}` : '/masters')} />}
        <Row icon="images-outline" title="Библиотека дизайнов" subtitle="Фото работ, теги, портфолио на сайте" onPress={() => router.push('/designs')} />
        {can(me, 'settings.manage') && <Row icon="card-outline" title="Онлайн-предоплата" subtitle="Через вашу ЮKassa — меньше неявок" onPress={() => router.push('/prepayment')} />}
        {can(me, 'settings.manage') && <Row icon="heart-outline" title="Возврат клиентов" subtitle="«Давно не были» и поздравления с днём рождения" onPress={() => router.push('/winback')} />}
        {!me.solo && (can(me, 'finance.manage') || me.resourceId) && (
          <Row icon="cash-outline" title={can(me, 'finance.manage') ? 'Зарплата мастеров' : 'Мой заработок'} subtitle={can(me, 'finance.manage') ? 'Процент, смены и оклад — расчёт за месяц' : 'Сколько начислено за период'} onPress={() => router.push('/payroll')} />
        )}
        {can(me, 'finance.manage') && <Row icon="wallet-outline" title="Депозиты и абонементы" subtitle="Бонус за пополнение, абонементы на визиты и непиковые часы" onPress={() => router.push('/loyalty')} />}
        {can(me, 'stock.manage') && <Row icon="cube-outline" title="Склад" subtitle={stockAlerts.data ? stockHint(stockAlerts.data) : 'Материалы, приход, остатки'} onPress={() => router.push('/stock')} />}
        {can(me, 'team.manage') && !me.solo && <Row icon="people-circle-outline" title="Команда" onPress={() => router.push('/team')} />}
        {isOwner && !me.solo && <Row icon="shield-checkmark-outline" title="Роли и доступы" subtitle="Кто что видит: записи, клиенты, отчёты" onPress={() => router.push('/roles')} />}
        {can(me, 'settings.manage') && <Row icon="settings-outline" title="Настройки салона" onPress={() => router.push('/salon')} />}
        <Row
          icon="card-outline"
          title="Подписка"
          subtitle={sub.data ? `${sub.data.plan.name} · ${SUB_STATUS[sub.data.status] ?? sub.data.status}${sub.data.daysLeft !== null && sub.data.status !== 'EXPIRED' ? ` · ${sub.data.daysLeft} дн.` : ''}` : undefined}
          onPress={() => router.push('/billing')}
        />
        <Row
          icon="paper-plane-outline"
          title="Уведомления в Telegram"
          subtitle={me.telegramLinked ? 'Подключены: новые записи и напоминания об оплате' : 'Узнавайте о новых онлайн-записях сразу'}
          onPress={toggleTelegram}
          right={<Text style={{ color: me.telegramLinked ? C.danger : C.brand, fontWeight: '600' }}>{me.telegramLinked ? 'Отключить' : 'Подключить'}</Text>}
        />
        <Row
          icon="shield-checkmark-outline"
          title="Вход с кодом"
          subtitle={me.twoFactor?.enabled ? `Включён: после пароля — код ${me.twoFactor.channels.includes('telegram') ? 'в Telegram' : 'на email'}` : 'Защитите базу клиентов: даже с паролем без кода не войти'}
          onPress={() => router.push('/two-factor')}
          right={<Text style={{ color: me.twoFactor?.enabled ? '#0F6B48' : C.brand, fontWeight: '600' }}>{me.twoFactor?.enabled ? 'Вкл.' : 'Включить'}</Text>}
        />
        {!can(me, 'staff.manage') && me.resourceId && <Row icon="time-outline" title="Мой график" onPress={() => router.push(`/master/${me.resourceId}`)} />}
      </View>

      {me.tenants.length > 1 && (
        <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#f1f5f9' }}>
          {me.tenants.filter((t) => t.id !== me.tenant.id).map((t) => (
            <Row key={t.id} icon="swap-horizontal" title={`Перейти: ${t.name}`} onPress={() => switchTenant(t.id)} />
          ))}
        </View>
      )}

      <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#f1f5f9' }}>
        {(can(me, 'customers.view') || can(me, 'catalog.manage')) && <Row icon="cloud-upload-outline" title="Перенос из YCLIENTS, DIKIDI, Excel" subtitle="Клиенты и услуги из файла" onPress={() => router.push('/import')} />}
        {can(me, 'customers.export') && <Row icon="download-outline" title="Выгрузить клиентов (Excel)" onPress={exportCustomers} />}
        <Row icon="trash-outline" title="Удалить аккаунт" onPress={() => router.push('/delete-account')} />
      </View>

      <Button
        title="Выйти"
        variant="danger"
        onPress={() => (Platform.OS === 'web' ? confirm('Выйти из аккаунта?') && logout() : Alert.alert('Выйти из аккаунта?', undefined, [{ text: 'Отмена', style: 'cancel' }, { text: 'Выйти', style: 'destructive', onPress: logout }]))}
      />
    </Screen>
  );
}
