import { api } from './api';

/** Кабинет клиента на mioflow.ru */
export type ClientMe = { id: string; name: string; email: string | null; emailVerified: boolean; phone: string | null; phoneVerified: boolean; hasPassword: boolean; yandex: boolean; vk: boolean };
export type ClientBooking = {
  slug: string; token: string; startsAt: string; status: string; price: number; services: string[]; serviceIds: string[];
  resource: string; resourceId: string; salon: { name: string; address: string | null; phone: string | null; timezone: string };
};

export const clientMe = () => api<ClientMe>('/client/me').catch(() => null);
export const oauthUrl = (p: 'yandex' | 'vk', consent: boolean) => `/v1/client/oauth/${p}/start${consent ? '?consent=1' : ''}`;
