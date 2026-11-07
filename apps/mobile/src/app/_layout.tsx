import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { C } from '../components/ui';
import { AuthProvider } from '../lib/auth';

export default function RootLayout() {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000 } } }));
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerTintColor: C.brand, headerTitleStyle: { color: C.text }, contentStyle: { backgroundColor: C.bg } }}>
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
