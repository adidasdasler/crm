import { GolosText_400Regular, GolosText_500Medium, GolosText_600SemiBold, GolosText_700Bold, useFonts } from '@expo-google-fonts/golos-text';
import { YesevaOne_400Regular } from '@expo-google-fonts/yeseva-one';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { F } from '../components/Text';
import { C, Loading } from '../components/ui';
import { AuthProvider } from '../lib/auth';
import { CACHE_MAX_AGE, flushOutbox, loadOutbox, persister, PERSIST_KEYS, setupNetwork } from '../lib/offline';

setupNetwork();

export default function RootLayout() {
  // offlineFirst: без сети показываем сохранённые данные, а не ошибку; кэш живёт до 7 дней
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000, gcTime: CACHE_MAX_AGE, networkMode: 'offlineFirst' },
    // Действия не «зависают» без сети: отметки визита уходят в очередь, остальное сразу пишет «нет связи»
    mutations: { networkMode: 'always' } } }));
  const [fontsLoaded, fontError] = useFonts({
    GolosText_400Regular, GolosText_500Medium, GolosText_600SemiBold, GolosText_700Bold, YesevaOne_400Regular,
  });
  // Если шрифты не загрузились (нет сети в вебе) — продолжаем с системными, а не висим на загрузке.
  if (!fontsLoaded && !fontError) return <Loading />;
  return (
    <SafeAreaProvider>
      <PersistQueryClientProvider
        client={qc}
        persistOptions={{
          persister, maxAge: CACHE_MAX_AGE, buster: 'v1',
          dehydrateOptions: { shouldDehydrateQuery: (q) => q.state.status === 'success' && PERSIST_KEYS.has(String(q.queryKey[0])) },
        }}
        onSuccess={() => { void loadOutbox().then(() => flushOutbox(qc)); }}
      >
        <AuthProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerTintColor: C.brand, headerTitleStyle: { color: C.text, fontFamily: F.semibold }, headerShadowVisible: false, contentStyle: { backgroundColor: C.bg } }}>
            <Stack.Screen name="(app)" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="register" options={{ title: 'Регистрация' }} />
            <Stack.Screen name="forgot" options={{ title: 'Восстановление пароля' }} />
            <Stack.Screen name="reset" options={{ title: 'Новый пароль' }} />
          </Stack>
        </AuthProvider>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}
