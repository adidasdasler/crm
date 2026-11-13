import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Text } from './Text';
import { C } from './ui';
import { API_URL, get } from '../lib/api';

export type OAuthResult = { ticket?: string; tf?: string; sent?: string; error?: string; register?: Record<string, string> };

/**
 * Кнопки «Войти с Яндекс ID» и «Войти с VK ID» для владельцев и мастеров.
 * Веб: переход на сервер, он вернёт сюда уже с сессией. Телефон: системный браузер,
 * возврат по ссылке mioflow://… с одноразовым билетом.
 */
export function OAuthButtons({ onResult }: { onResult: (r: OAuthResult) => void }) {
  const [providers, setProviders] = useState<string[]>([]);
  useEffect(() => { get<{ providers: string[] }>('/auth/oauth/config').then((r) => setProviders(r.providers)).catch(() => null); }, []);
  if (!providers.length) return null;

  async function start(p: string) {
    if (Platform.OS === 'web') {
      window.location.href = `${API_URL}/auth/oauth/${p}/start`;
      return;
    }
    const r = await WebBrowser.openAuthSessionAsync(`${API_URL}/auth/oauth/${p}/start?mobile=1`, 'mioflow://');
    if (r.type !== 'success') return;
    const url = new URL(r.url.replace(/^mioflow:\/\//, 'https://app/'));
    const q = Object.fromEntries(url.searchParams.entries());
    if (url.pathname === '/register') onResult({ register: q });
    else onResult({ ticket: q.ticket, tf: q.tf, sent: q.sent, error: q.error });
  }

  const btn = (p: string, label: string, bg: string) => (
    <Pressable key={p} onPress={() => void start(p)} accessibilityRole="button"
      style={({ pressed }) => ({ backgroundColor: bg, borderRadius: 999, paddingVertical: 14, alignItems: 'center', opacity: pressed ? 0.85 : 1 })}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ gap: 10 }}>
      {providers.includes('yandex') && btn('yandex', 'Войти с Яндекс ID', '#FC3F1D')}
      {providers.includes('vk') && btn('vk', 'Войти с VK ID', '#0077FF')}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 2 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: C.border }} /><Text style={{ color: C.muted, fontSize: 13 }}>или по email</Text><View style={{ flex: 1, height: 1, backgroundColor: C.border }} />
      </View>
    </View>
  );
}

/** Новый пользователь после Яндекс/VK — на регистрацию с подставленными данными */
export const goRegister = (q: Record<string, string>) => router.push({ pathname: '/register', params: q });
