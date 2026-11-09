import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { onlineManager, QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { API_URL, ApiError, post } from './api';
import type { Booking, BookingStatus } from './types';

/**
 * Офлайн-режим: «аварийная страховка» на случай плохого интернета в салоне.
 *  - Ответы сервера сохраняются в телефоне (до 7 дней) — расписание и карточки открываются без сети.
 *  - Отметки «пришёл / завершён / не пришёл / подтвердил» без сети копятся в очереди и
 *    отправляются по порядку, когда связь появится. Если запись за это время изменил другой
 *    сотрудник, отметка не применяется — показываем конфликт, ничего не перезаписываем.
 *  - Новые записи офлайн создавать нельзя: иначе возможна двойная запись на одно время.
 */

export const CACHE_MAX_AGE = 7 * 24 * 3600_000;
const CACHE_KEY = 'mioflow-cache-v1';
const OUTBOX_KEY = 'mioflow-outbox-v1';

export const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: CACHE_KEY, throttleTime: 1000 });

/** Что сохраняем: только то, что нужно для работы без сети (без ответов с ошибками) */
export const PERSIST_KEYS = new Set(['bookings', 'booking', 'resources', 'services', 'customers', 'analytics', 'tenant']);

/** Связь: NetInfo (iOS/Android/веб) → onlineManager React Query (запросы ставятся на паузу без сети) */
let netSetup = false;
export function setupNetwork() {
  if (netSetup) return;
  netSetup = true;
  // В браузере React Query сам слушает события online/offline — этого достаточно и надёжнее.
  if (Platform.OS === 'web') return;
  // На телефоне — NetInfo. Доступность проверяем своим API, а не серверами Google:
  // лишняя передача данных за рубеж нам не нужна.
  NetInfo.configure({ reachabilityUrl: `${API_URL}/health`, reachabilityTest: async (r) => r.status === 200, reachabilityMethod: 'GET' });
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((s) => setOnline(!!s.isConnected && s.isInternetReachable !== false)),
  );
}

export function useOnline() {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  );
}

// ─── Очередь отметок ───
export type QueuedStatus = { id: string; bookingId: string; status: BookingStatus; version?: number; label: string; at: string };
export type Conflict = QueuedStatus & { reason: string };
type State = { queue: QueuedStatus[]; conflicts: Conflict[]; syncing: boolean };

let state: State = { queue: [], conflicts: [], syncing: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const save = () => AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify({ queue: state.queue, conflicts: state.conflicts })).catch(() => null);
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; emit(); };

export async function loadOutbox() {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<State>;
      set({ queue: s.queue ?? [], conflicts: s.conflicts ?? [] });
    }
  } catch {
    // повреждённые данные очереди — начинаем с пустой
  }
}

export function useOutbox() {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state, () => state);
}

/** Поставить отметку в очередь и сразу показать её в кэше (оптимистично) */
export function enqueueStatus(qc: QueryClient, b: Pick<Booking, 'id' | 'version'>, status: BookingStatus, label: string) {
  // Повторная отметка той же записи заменяет предыдущую: на сервер уйдёт итоговый статус
  const rest = state.queue.filter((x) => x.bookingId !== b.id);
  const prevVersion = state.queue.find((x) => x.bookingId === b.id)?.version ?? b.version;
  set({ queue: [...rest, { id: `${b.id}:${Date.now()}`, bookingId: b.id, status, version: prevVersion, label, at: new Date().toISOString() }] });
  void save();
  patchBooking(qc, b.id, { status });
}

function patchBooking(qc: QueryClient, id: string, patch: Partial<Booking>) {
  qc.setQueryData<Booking>(['booking', id], (old) => (old ? { ...old, ...patch } : old));
  qc.setQueriesData<Booking[]>({ queryKey: ['bookings'] }, (old) => (Array.isArray(old) ? old.map((x) => (x.id === id ? { ...x, ...patch } : x)) : old));
}

/** Отправить очередь по порядку. Сетевая ошибка — остановиться и подождать связи. */
export async function flushOutbox(qc: QueryClient) {
  if (state.syncing || !state.queue.length || !onlineManager.isOnline()) return;
  set({ syncing: true });
  try {
    while (state.queue.length) {
      const item = state.queue[0];
      try {
        const b = await post<Booking>(`/bookings/${item.bookingId}/status`, { status: item.status, version: item.version });
        qc.setQueryData(['booking', item.bookingId], b);
      } catch (e) {
        const err = e as ApiError;
        if (err.status === 0) break; // снова нет сети — попробуем позже
        // Запись изменили на сервере, переход невозможен или запись удалена — не перезаписываем
        const reason = err.code === 'BOOKING_VERSION_MISMATCH'
          ? 'запись изменил другой сотрудник, пока не было связи'
          : err.code === 'INVALID_TRANSITION' ? 'статус записи уже другой' : err.message;
        set({ conflicts: [...state.conflicts, { ...item, reason }] });
      }
      set({ queue: state.queue.slice(1) });
      await save();
    }
  } finally {
    set({ syncing: false });
    void qc.invalidateQueries({ queryKey: ['bookings'] });
    void qc.invalidateQueries({ queryKey: ['booking'] });
    void qc.invalidateQueries({ queryKey: ['analytics'] });
  }
}

export function dismissConflicts() {
  set({ conflicts: [] });
  void save();
}

/** Выход из аккаунта: в телефоне не должно оставаться данных салона */
export async function clearOffline() {
  set({ queue: [], conflicts: [] });
  await Promise.all([AsyncStorage.removeItem(OUTBOX_KEY), AsyncStorage.removeItem(CACHE_KEY), persister.removeClient()]).catch(() => null);
}
