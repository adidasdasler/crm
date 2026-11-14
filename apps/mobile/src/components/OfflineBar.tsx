import { Ionicons } from '@expo/vector-icons';
import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Alert, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dismissConflicts, flushOutbox, useOnline, useOutbox } from '../lib/offline';
import { Text } from './Text';

/**
 * Полоса состояния сети над приложением:
 *  - нет интернета: работаем с сохранёнными данными, отметки копятся;
 *  - связь появилась: отправляем отметки по порядку;
 *  - отметку не удалось применить (запись изменили) — показываем, ничего не перезаписываем.
 */
/** Видна ли полоса — чтобы не добавлять отступ под вырезом экрана дважды (полоса + заголовок) */
export function useOfflineBarVisible() {
  const online = useOnline();
  const { queue, conflicts, syncing } = useOutbox();
  return !online || !!conflicts.length || syncing || !!queue.length;
}

export function OfflineBar() {
  const online = useOnline();
  const { queue, conflicts, syncing } = useOutbox();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();

  // Связь вернулась — отправляем очередь
  useEffect(() => onlineManager.subscribe((isOnline) => { if (isOnline) void flushOutbox(qc); }), [qc]);
  // Связь «есть», но сервер не ответил (слабый сигнал) — повторяем раз в 30 секунд, пока очередь не пуста
  useEffect(() => {
    if (!queue.length) return;
    const t = setInterval(() => void flushOutbox(qc), 30_000);
    return () => clearInterval(t);
  }, [queue.length, qc]);

  const showConflicts = () => {
    const text = conflicts.map((c) => `• ${c.label}: ${c.reason}`).join('\n');
    const title = 'Отметки не применены';
    if (Platform.OS === 'web') { alert(`${title}\n\n${text}\n\nПроверьте эти записи вручную.`); dismissConflicts(); return; }
    Alert.alert(title, `${text}\n\nПроверьте эти записи вручную.`, [{ text: 'Понятно', onPress: dismissConflicts }]);
  };

  let content: { icon: 'cloud-offline-outline' | 'sync-outline' | 'alert-circle-outline'; text: string; bg: string; fg: string; onPress?: () => void } | null = null;
  if (conflicts.length) {
    content = { icon: 'alert-circle-outline', text: `Не применено отметок: ${conflicts.length} — нажмите, чтобы посмотреть`, bg: '#FDECE7', fg: '#9A2A08', onPress: showConflicts };
  } else if (!online) {
    content = { icon: 'cloud-offline-outline', text: `Нет интернета — показаны сохранённые данные${queue.length ? ` · отметок в очереди: ${queue.length}` : ''}`, bg: '#0E0F2B', fg: '#FFFFFF' };
  } else if (syncing || queue.length) {
    content = { icon: 'sync-outline', text: `Отправляем отметки: ${queue.length}`, bg: '#EEF0FF', fg: '#1F28D6' };
  }
  if (!content) return null;
  return (
    <Pressable onPress={content.onPress} disabled={!content.onPress} accessibilityRole={content.onPress ? 'button' : 'text'} accessibilityLiveRegion="polite">
      <View style={{ backgroundColor: content.bg, paddingTop: insets.top + 6, paddingBottom: 8, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name={content.icon} size={16} color={content.fg} />
        <Text style={{ color: content.fg, fontSize: 13, flex: 1 }}>{content.text}</Text>
      </View>
    </Pressable>
  );
}
