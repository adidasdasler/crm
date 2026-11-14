import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { post } from './api';

/** Push-токен этого устройства (для отвязки при выходе). */
let currentToken: string | null = null;

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

/**
 * Зарегистрировать устройство для push-уведомлений о новых записях.
 * Работает только в сборке EAS на реальном устройстве (нужен projectId из `eas init`).
 * Тихо пропускается в вебе, в эмуляторе и до настройки EAS.
 */
export async function registerPush(): Promise<void> {
  if (Platform.OS === 'web' || !Device.isDevice) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) return;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'Записи', importance: Notifications.AndroidImportance.HIGH });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    currentToken = data;
    await post('/me/push-tokens', { token: data, platform: Platform.OS });
  } catch {
    // Нет сети или сервисов Google на устройстве — без push приложение работает как обычно.
  }
}

export async function unregisterPush() {
  if (!currentToken) return;
  await post('/me/push-tokens/remove', { token: currentToken }).catch(() => null);
  currentToken = null;
}

/** Нажатие на уведомление → открыть запись. */
export function listenNotificationTaps() {
  if (Platform.OS === 'web') return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    const id = r.notification.request.content.data?.bookingId;
    if (typeof id === 'string') router.push(`/booking/${id}`);
  });
  return () => sub.remove();
}
