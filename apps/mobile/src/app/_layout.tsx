import { GolosText_400Regular, GolosText_500Medium, GolosText_600SemiBold, GolosText_700Bold, useFonts } from '@expo-google-fonts/golos-text';
import { YesevaOne_400Regular } from '@expo-google-fonts/yeseva-one';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { F } from '../components/Text';
import { C, Loading } from '../components/ui';
import { AuthProvider } from '../lib/auth';

export default function RootLayout() {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000 } } }));
  const [fontsLoaded, fontError] = useFonts({
    GolosText_400Regular, GolosText_500Medium, GolosText_600SemiBold, GolosText_700Bold, YesevaOne_400Regular,
  });
  // Если шрифты не загрузились (нет сети в вебе) — продолжаем с системными, а не висим на загрузке.
  if (!fontsLoaded && !fontError) return <Loading />;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={qc}>
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
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
