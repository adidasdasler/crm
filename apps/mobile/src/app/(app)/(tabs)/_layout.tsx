import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import { C } from '../../../components/ui';
import { canManage, useMe } from '../../../lib/auth';

export default function TabsLayout() {
  const me = useMe();
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: C.brand, headerTitleStyle: { color: C.text } }}>
      <Tabs.Screen name="index" options={{ title: 'Календарь', headerTitle: me.tenant.name, tabBarIcon: ({ color, size }) => <Ionicons name="calendar" color={color as string} size={size} /> }} />
      <Tabs.Screen name="customers" options={{ title: 'Клиенты', tabBarIcon: ({ color, size }) => <Ionicons name="people" color={color as string} size={size} /> }} />
      <Tabs.Screen
        name="services"
        options={{ title: 'Услуги', href: canManage(me.role) ? undefined : null, tabBarIcon: ({ color, size }) => <Ionicons name="pricetags" color={color as string} size={size} /> }}
      />
      <Tabs.Screen name="more" options={{ title: 'Ещё', tabBarIcon: ({ color, size }) => <Ionicons name="menu" color={color as string} size={size} /> }} />
    </Tabs>
  );
}
