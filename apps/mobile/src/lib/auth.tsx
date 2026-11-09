import { useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, get, post, setOnUnauthorized, tokens } from './api';
import { clearOffline } from './offline';

const ME_KEY = 'mioflow-me-v1';
import { unregisterPush } from './push';
import type { Me, Perm } from './types';

type AuthState = {
  status: 'loading' | 'guest' | 'authed';
  me: Me | null;
  login: (email: string, password: string) => Promise<void>;
  register: (dto: Record<string, unknown>) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [me, setMe] = useState<Me | null>(null);

  const reload = useCallback(async () => {
    try {
      const m = await get<Me>('/auth/me');
      setMe(m);
      setStatus('authed');
      void AsyncStorage.setItem(ME_KEY, JSON.stringify(m)).catch(() => null);
    } catch (e) {
      // Нет сети, но вход был — работаем с сохранённым профилем (офлайн-режим)
      // В вебе сессия в cookie — токена в памяти нет
      if ((e as ApiError).status === 0 && (Platform.OS === 'web' || (await tokens.access()))) {
        const cached = await AsyncStorage.getItem(ME_KEY).catch(() => null);
        if (cached) {
          setMe(JSON.parse(cached) as Me);
          setStatus('authed');
          return;
        }
      }
      setMe(null);
      setStatus('guest');
    }
  }, []);

  useEffect(() => {
    setOnUnauthorized(() => { setMe(null); setStatus('guest'); qc.clear(); void AsyncStorage.removeItem(ME_KEY).catch(() => null); void clearOffline(); });
    tokens.load().then(reload);
  }, [reload, qc]);

  const value: AuthState = {
    status,
    me,
    reload,
    async login(email, password) {
      await tokens.save(await post('/auth/login', { email, password }));
      await reload();
    },
    async register(dto) {
      await tokens.save(await post('/auth/register', dto));
      await reload();
    },
    async logout() {
      await unregisterPush();
      await post('/auth/logout', { refreshToken: (await tokens.refresh()) ?? undefined }).catch(() => null);
      await tokens.clear();
      qc.clear();
      await Promise.all([AsyncStorage.removeItem(ME_KEY).catch(() => null), clearOffline()]);
      setMe(null);
      setStatus('guest');
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth вне AuthProvider');
  return v;
}

/** Текущий салон (гарантированно есть внутри (app)) */
export function useMe() {
  return useAuth().me!;
}
export const canManage = (role?: string) => role === 'OWNER' || role === 'MANAGER' || role === 'ADMIN';
/** Есть ли у текущего пользователя право (настраивается владельцем в «Ролях и доступах») */
export const can = (me: Pick<Me, 'role' | 'permissions'> | null | undefined, p: Perm) => !!me && (me.role === 'OWNER' || (me.permissions ?? []).includes(p));
const DEFAULT_TERMS = { staff: 'Мастер', staffPlural: 'Мастера', client: 'Клиент', clientPlural: 'Клиенты', place: 'Салон' };
/** Слова интерфейса для сферы бизнеса салона */
export const useTerms = () => useAuth().me?.industry?.terms ?? DEFAULT_TERMS;
export function useCan(p: Perm) {
  return can(useAuth().me, p);
}
