import { Ionicons } from '@expo/vector-icons';
import { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, TextInputProps, View, ViewStyle,
} from 'react-native';

export const C = {
  brand: '#7c3aed',
  brandDark: '#6d28d9',
  brandSoft: '#ede9fe',
  bg: '#f8fafc',
  card: '#ffffff',
  text: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  danger: '#dc2626',
  success: '#059669',
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
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={s.body}>{label}</Text>
        {hint && <Text style={s.muted}>{hint}</Text>}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: C.brand, false: C.border }} />
    </View>
  );
}

export function Chip({ label, active, onPress, color }: { label: string; active?: boolean; onPress?: () => void; color?: string }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, active && { backgroundColor: color ?? C.brand, borderColor: color ?? C.brand }]}>
      <Text style={{ color: active ? '#fff' : C.text, fontWeight: '600' }}>{label}</Text>
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
  card: { backgroundColor: C.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#f1f5f9', gap: 6 },
  btn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18, minHeight: 50 },
  btnGhost: { borderWidth: 1, borderColor: C.border },
  btnText: { fontSize: 16, fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '600', color: C.muted },
  input: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: C.text },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: C.card },
  rowIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.brandSoft, alignItems: 'center', justifyContent: 'center' },
  body: { fontSize: 16, color: C.text, fontWeight: '500' },
  muted: { fontSize: 14, color: C.muted },
  h: { fontSize: 18, fontWeight: '700', color: C.text, marginTop: 8 },
  error: { backgroundColor: '#fef2f2', color: '#b91c1c', padding: 12, borderRadius: 12, overflow: 'hidden' },
  fab: {
    position: 'absolute', right: 20, width: 60, height: 60, borderRadius: 30, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
});
