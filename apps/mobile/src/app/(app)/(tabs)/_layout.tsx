import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import { Platform } from 'react-native';
import { F, Text } from '../../../components/Text';
import { C } from '../../../components/ui';
import { canManage, useMe } from '../../../lib/auth';

export default function TabsLayout() {
  const me = useMe();
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: C.brand,
      tabBarInactiveTintColor: C.muted,
      // Своя подпись: встроенная сжимает высоту строки, и буквы Golos обрезаются снизу
      tabBarLabel: ({ color, children }) => <Text numberOfLines={1} style={{ color: color as string, fontFamily: F.medium, fontSize: 11, lineHeight: 15 }}>{children}</Text>,
      // Golos выше системного шрифта — даём панели запас по высоте, иначе подписи обрезаются
      tabBarStyle: { borderTopColor: C.border, height: Platform.OS === 'web' ? 66 : undefined, paddingTop: 4 },
      tabBarItemStyle: { paddingBottom: Platform.OS === 'web' ? 8 : 0 },
      headerTitleStyle: { color: C.text, fontFamily: F.display, fontSize: 22 },
      headerShadowVisible: false,
    }}>
      <Tabs.Screen name="index" options={{ title: 'Календарь', headerTitle: me.tenant.name, tabBarIcon: ({ color }) => <Ionicons name="calendar" color={color as string} size={24} /> }} />
      <Tabs.Screen name="customers" options={{ title: 'Клиенты', tabBarIcon: ({ color }) => <Ionicons name="people" color={color as string} size={24} /> }} />
      <Tabs.Screen
        name="services"
        options={{ title: 'Услуги', href: canManage(me.role) ? undefined : null, tabBarIcon: ({ color }) => <Ionicons name="pricetags" color={color as string} size={24} /> }}
      />
      <Tabs.Screen name="more" options={{ title: 'Ещё', tabBarIcon: ({ color }) => <Ionicons name="menu" color={color as string} size={24} /> }} />
    </Tabs>
  );
}
