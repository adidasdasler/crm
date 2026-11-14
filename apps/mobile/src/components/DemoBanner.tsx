import { router } from 'expo-router';
import { Pressable } from 'react-native';
import { Text } from './Text';
import { useAuth } from '../lib/auth';

/** Полоса над всеми экранами демо-салона: что это и как завести свой */
export function DemoBanner() {
  const { me, logout } = useAuth();
  if (me?.tenant?.slug !== 'demo') return null;
  return (
    <Pressable
      onPress={async () => { await logout(); router.replace('/register'); }}
      accessibilityRole="button"
      style={{ backgroundColor: '#FFF4D6', paddingHorizontal: 16, paddingVertical: 8 }}
    >
      <Text style={{ color: '#7A4B00', fontSize: 13 }}>
        Это демо: пробуйте всё что угодно, ночью данные вернутся к исходным. <Text style={{ fontWeight: '700', color: '#7A4B00' }}>Создать свой салон →</Text>
      </Text>
    </Pressable>
  );
}
