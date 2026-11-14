import { Ionicons } from '@expo/vector-icons';
import { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput, TextInputProps, View, ViewStyle,
} from 'react-native';
import { F, Text } from './Text';

/** Палитра бренда MioFlow (docs/BRAND.md) */
export const C = {
  brand: '#2F3BFF', // ультрамарин — кнопки, выбранное, знак
  brandDark: '#1F28D6',
  brandSoft: '#EEF0FF', // иней — подложки иконок и выделений
  accent: '#FFC7D6', // пудра — «свободно», выбранное время, точка-уведомление
  bg: '#F7F7FC',
  card: '#FFFFFF',
  text: '#0E0F2B', // ночь
  muted: '#5A5E7E',
  border: '#E3E5F2',
  danger: '#C4320A',
  success: '#0F7A52',
};

export function Screen({ children, scroll = true, padded = true }: { children: ReactNode; scroll?: boolean; padded?: boolean }) {
  const style: ViewStyle = { padding: padded ? 16 : 0, gap: 12, paddingBottom: 40 };
  return scroll ? (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={[style, maxW]} keyboardShouldPersistTaps="handled">{children}</ScrollView>
  ) : (
    <View style={[{ flex: 1, backgroundColor: C.bg }, style, maxW]}>{children}</View>
  );
}
/** На вебе/планшете не растягиваем контент на всю ширину. */
const maxW: ViewStyle = Platform.OS === 'web' ? { width: '100%', maxWidth: 760, alignSelf: 'center' } : {};
/** Ограничение ширины списков на широком экране (веб-версия на компьютере) */
export const webMax = maxW;

export function Card({ children, style, onPress }: { children: ReactNode; style?: ViewStyle; onPress?: () => void }) {
  const body = <View style={[s.card, style]}>{children}</View>;
  return onPress ? <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>{body}</Pressable> : body;
}

export function Button({
  title, onPress, variant = 'primary', loading, disabled, icon, style,
}: {
  title: string; onPress: () => void; variant?: 'primary' | 'ghost' | 'danger'; loading?: boolean; disabled?: boolean;
  icon?: ComponentProps<typeof Ionicons>['name']; style?: ViewStyle;
}) {
  const bg = variant === 'primary' ? C.brand : C.card;
  const fg = variant === 'primary' ? '#fff' : variant === 'danger' ? C.danger : C.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }, variant !== 'primary' && s.btnGhost, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : (
        <>
          {icon && <Ionicons name={icon} size={18} color={fg} />}
          <Text style={[s.btnText, { color: fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Field({ label, error, ...props }: TextInputProps & { label?: string; error?: string }) {
  return (
    <View style={{ gap: 6 }}>
      {label && <Text style={s.label}>{label}</Text>}
      <TextInput placeholderTextColor="#94a3b8" {...props} style={[s.input, props.multiline && { minHeight: 80, textAlignVertical: 'top' }, error && { borderColor: C.danger }, props.style]} />
      {error && <Text style={{ color: C.danger, fontSize: 13 }}>{error}</Text>}
    </View>
  );
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  // Нажимается вся строка, а не только маленький переключатель
  return (
    <Pressable onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={s.body}>{label}</Text>
        {hint && <Text style={s.muted}>{hint}</Text>}
      </View>
      {/* Нажатие обрабатывает только строка: иначе в вебе переключатель сработал бы дважды и вернулся назад */}
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants">
        <Switch value={value} trackColor={{ true: C.brand, false: C.border }} thumbColor="#FFFFFF" {...({ activeThumbColor: '#FFFFFF' } as object)} />
      </View>
    </Pressable>
  );
}

/** tone="accent" — пудровая заливка с тёмным текстом (выбранное время), по умолчанию — ультрамарин */
export function Chip({ label, active, onPress, color, tone }: { label: string; active?: boolean; onPress?: () => void; color?: string; tone?: 'accent' }) {
  const bg = tone === 'accent' ? C.accent : color ?? C.brand;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!active }} style={[s.chip, active && { backgroundColor: bg, borderColor: bg }]}>
      <Text style={{ color: active ? (tone === 'accent' ? C.text : '#fff') : C.text, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function Row({ icon, title, subtitle, onPress, right }: {
  icon?: ComponentProps<typeof Ionicons>['name']; title: string; subtitle?: string; onPress?: () => void; right?: ReactNode;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.row, pressed && { backgroundColor: '#f1f5f9' }]}>
      {icon && <View style={s.rowIcon}><Ionicons name={icon} size={20} color={C.brand} /></View>}
      <View style={{ flex: 1 }}>
        <Text style={s.body}>{title}</Text>
        {subtitle ? <Text style={s.muted} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress && <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />)}
    </Pressable>
  );
}

export function Empty({ icon = 'calendar-outline', text, action }: { icon?: ComponentProps<typeof Ionicons>['name']; text: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, gap: 12 }}>
      <Ionicons name={icon} size={44} color="#cbd5e1" />
      <Text style={[s.muted, { textAlign: 'center', fontSize: 15 }]}>{text}</Text>
      {action}
    </View>
  );
}

export const Loading = () => <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg }}><ActivityIndicator color={C.brand} size="large" /></View>;

export function ErrorText({ error }: { error?: unknown }) {
  if (!error) return null;
  return <Text style={s.error}>{(error as Error).message}</Text>;
}

export function Fab({ onPress, icon = 'add', label = 'Добавить' }: { onPress: () => void; icon?: ComponentProps<typeof Ionicons>['name']; label?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [s.fab, { bottom: 20, opacity: pressed ? 0.85 : 1 }]}>
      <Ionicons name={icon} size={28} color="#fff" />
    </Pressable>
  );
}

export const H = ({ children }: { children: ReactNode }) => <Text style={s.h}>{children}</Text>;
export const Muted = ({ children }: { children: ReactNode }) => <Text style={s.muted}>{children}</Text>;

export const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: '#EEF0F7', gap: 6 },
  btn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 999, paddingVertical: 14, paddingHorizontal: 22, minHeight: 52 },
  btnGhost: { borderWidth: 1, borderColor: C.border },
  btnText: { fontSize: 16, fontWeight: '600' },
  label: { fontSize: 13, fontFamily: F.semibold, color: C.muted },
  input: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13, fontSize: 16, color: C.text, fontFamily: F.regular },
  chip: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: C.card },
  rowIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.brandSoft, alignItems: 'center', justifyContent: 'center' },
  body: { fontSize: 16, color: C.text, fontWeight: '500' },
  muted: { fontSize: 14, color: C.muted },
  h: { fontSize: 22, fontFamily: F.display, color: C.text, marginTop: 10 },
  error: { backgroundColor: '#FDECE7', color: '#9A2A08', padding: 12, borderRadius: 14, overflow: 'hidden' },
  fab: {
    position: 'absolute', right: 20, width: 60, height: 60, borderRadius: 30, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#2F3BFF', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
});

/** Логотип MioFlow: знак + слово. size — высота знака. */
export function Logo({ size = 40, color = C.text }: { size?: number; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.3 }} accessibilityRole="image" accessibilityLabel="MioFlow">
      <Image source={require('../../assets/splash-icon.png')} style={{ width: size, height: size }} />
      <Text style={{ fontFamily: F.display, fontSize: size * 1.05, lineHeight: size * 1.15, color }}>MioFlow</Text>
    </View>
  );
}
