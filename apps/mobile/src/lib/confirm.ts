import { Alert, Platform } from 'react-native';

/** Вопрос «да/нет», одинаково на телефоне и в браузере */
export function confirm(title: string, message: string, ok = 'Да'): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Отмена', style: 'cancel', onPress: () => resolve(false) },
      { text: ok, style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }),
  );
}
