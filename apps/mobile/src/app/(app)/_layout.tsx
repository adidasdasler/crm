import { Redirect, Stack } from 'expo-router';
import { useEffect } from 'react';
import { listenNotificationTaps, registerPush } from '../../lib/push';
import { F } from '../../components/Text';
import { C, Loading } from '../../components/ui';
import { useAuth } from '../../lib/auth';

/** Всё внутри (app) — только для вошедших. */
export default function AppLayout() {
  const { status } = useAuth();
  useEffect(() => {
    if (status !== 'authed') return;
    registerPush();
    return listenNotificationTaps();
  }, [status]);
  if (status === 'loading') return <Loading />;
  if (status === 'guest') return <Redirect href="/login" />;
  return (
    <Stack screenOptions={{ headerTintColor: C.brand, headerTitleStyle: { color: C.text, fontFamily: F.semibold }, headerShadowVisible: false, headerBackTitle: 'Назад', contentStyle: { backgroundColor: C.bg } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="booking/new" options={{ title: 'Новая запись', presentation: 'modal' }} />
      <Stack.Screen name="booking/[id]" options={{ title: 'Запись' }} />
      <Stack.Screen name="customer/[id]" options={{ title: 'Клиент' }} />
      <Stack.Screen name="service/[id]" options={{ title: 'Услуга', presentation: 'modal' }} />
      <Stack.Screen name="master/[id]" options={{ title: 'Мастер' }} />
      <Stack.Screen name="masters" options={{ title: 'Мастера' }} />
      <Stack.Screen name="team" options={{ title: 'Команда' }} />
      <Stack.Screen name="salon" options={{ title: 'Настройки салона' }} />
      <Stack.Screen name="billing" options={{ title: 'Подписка' }} />
      <Stack.Screen name="delete-account" options={{ title: 'Удаление аккаунта' }} />
    </Stack>
  );
}
