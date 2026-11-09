import { Redirect, Stack } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfflineBar, useOfflineBarVisible } from '../../components/OfflineBar';
import { useEffect } from 'react';
import { listenNotificationTaps, registerPush } from '../../lib/push';
import { F } from '../../components/Text';
import { C, Loading } from '../../components/ui';
import { useAuth } from '../../lib/auth';

/** Всё внутри (app) — только для вошедших. */
export default function AppLayout() {
  const { status } = useAuth();
  const insets = useSafeAreaInsets();
  const bar = useOfflineBarVisible();
  useEffect(() => {
    if (status !== 'authed') return;
    registerPush();
    return listenNotificationTaps();
  }, [status]);
  if (status === 'loading') return <Loading />;
  if (status === 'guest') return <Redirect href="/login" />;
  return (
    <View style={{ flex: 1 }}>
      <OfflineBar />
      {/* Полоса уже заняла место под вырезом экрана — заголовкам отступ сверху не нужен */}
      <SafeAreaInsetsContext.Provider value={bar ? { ...insets, top: 0 } : insets}>
    <Stack screenOptions={{ headerTintColor: C.brand, headerTitleStyle: { color: C.text, fontFamily: F.semibold }, headerShadowVisible: false, headerBackTitle: 'Назад', contentStyle: { backgroundColor: C.bg } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="booking/new" options={{ title: 'Новая запись', presentation: 'modal' }} />
      <Stack.Screen name="booking/[id]" options={{ title: 'Запись' }} />
      <Stack.Screen name="timeoff/new" options={{ title: 'Закрыть время', presentation: 'modal' }} />
      <Stack.Screen name="customer/[id]" options={{ title: 'Клиент' }} />
      <Stack.Screen name="service/[id]" options={{ title: 'Услуга', presentation: 'modal' }} />
      <Stack.Screen name="master/[id]" options={{ title: 'Мастер' }} />
      <Stack.Screen name="masters" options={{ title: 'Мастера' }} />
      <Stack.Screen name="team" options={{ title: 'Команда' }} />
      <Stack.Screen name="roles" options={{ title: 'Роли и доступы' }} />
      <Stack.Screen name="maps" options={{ title: 'Карты и ссылки' }} />
      <Stack.Screen name="loyalty" options={{ title: 'Депозиты и абонементы' }} />
      <Stack.Screen name="designs/index" options={{ title: 'Библиотека дизайнов' }} />
      <Stack.Screen name="designs/new" options={{ title: 'Фото работы', presentation: 'modal' }} />
      <Stack.Screen name="designs/[id]" options={{ title: 'Дизайн' }} />
      <Stack.Screen name="stock/index" options={{ title: 'Склад' }} />
      <Stack.Screen name="stock/[id]" options={{ title: 'Материал' }} />
      <Stack.Screen name="stock/inventory" options={{ title: 'Инвентаризация' }} />
      <Stack.Screen name="salon" options={{ title: 'Настройки салона' }} />
      <Stack.Screen name="billing" options={{ title: 'Подписка' }} />
      <Stack.Screen name="delete-account" options={{ title: 'Удаление аккаунта' }} />
    </Stack>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}
