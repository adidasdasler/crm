import { useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { get, post, setOnUnauthorized, tokens } from './api';
import { unregisterPush } from './push';
import type { Me } from './types';

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
      setMe(await get<Me>('/auth/me'));
      setStatus('authed');
    } catch {
      setMe(null);
      setStatus('guest');
    }
  }, []);

  useEffect(() => {
    setOnUnauthorized(() => { setMe(null); setStatus('guest'); qc.clear(); });
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
