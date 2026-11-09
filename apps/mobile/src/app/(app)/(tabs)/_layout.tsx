import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import { ComponentProps } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { F, Text } from '../../../components/Text';
import { C } from '../../../components/ui';
import { can, useMe, useTerms } from '../../../lib/auth';

type Icon = ComponentProps<typeof Ionicons>['name'];
const icon = (name: Icon) => ({ color }: { color: unknown }) => <Ionicons name={name} color={color as string} size={24} />;

/**
 * Телефон — нижняя панель; компьютер и планшет (веб-версия CRM) — боковое меню слева.
 * Разделы показываются по правам роли (см. «Роли и доступы»).
 */
export default function TabsLayout() {
  const me = useMe();
  const terms = useTerms();
  const { width } = useWindowDimensions();
  const side = width >= 1024;
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: C.brand,
        tabBarInactiveTintColor: C.muted,
        tabBarPosition: side ? 'left' : 'bottom',
        tabBarVariant: side ? 'material' : 'uikit',
        tabBarLabelPosition: side ? 'beside-icon' : 'below-icon',
        tabBarActiveBackgroundColor: side ? C.brandSoft : undefined,
        // Своя подпись: встроенная сжимает высоту строки, и буквы Golos обрезаются снизу
        tabBarLabel: ({ color, children }) => (
          <Text numberOfLines={1} style={{ color: color as string, fontFamily: F.medium, fontSize: side ? 15 : 11, lineHeight: side ? 20 : 15, marginLeft: side ? 12 : 0 }}>{children}</Text>
        ),
        tabBarStyle: side
          ? { width: 240, borderRightColor: C.border, backgroundColor: C.card, paddingTop: 16 }
          : { borderTopColor: C.border, height: Platform.OS === 'web' ? 66 : undefined, paddingTop: 4 },
        tabBarItemStyle: side ? { borderRadius: 14, marginHorizontal: 10, marginVertical: 2, justifyContent: 'flex-start', paddingHorizontal: 12 } : { paddingBottom: Platform.OS === 'web' ? 8 : 0 },
        headerTitleStyle: { color: C.text, fontFamily: F.display, fontSize: 22 },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Записи', headerTitle: me.tenant.name, tabBarIcon: icon('calendar') }} />
      <Tabs.Screen name="dashboard" options={{ title: 'Обзор', headerTitle: 'Обзор салона', href: can(me, 'analytics.view') ? undefined : null, tabBarIcon: icon('stats-chart') }} />
      <Tabs.Screen name="customers" options={{ title: terms.clientPlural, tabBarIcon: icon('people') }} />
      <Tabs.Screen name="services" options={{ title: 'Услуги', href: can(me, 'catalog.manage') ? undefined : null, tabBarIcon: icon('pricetags') }} />
      <Tabs.Screen name="more" options={{ title: 'Ещё', tabBarIcon: icon('menu') }} />
    </Tabs>
  );
}
