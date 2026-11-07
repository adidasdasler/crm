import { Text as RNText, TextProps, StyleSheet, TextStyle } from 'react-native';

/** Фирменные шрифты «Пора». Названия совпадают с ключами useFonts в app/_layout.tsx. */
export const F = {
  regular: 'GolosText_400Regular',
  medium: 'GolosText_500Medium',
  semibold: 'GolosText_600SemiBold',
  bold: 'GolosText_700Bold',
  /** Заголовки: контрастная антиква. Один начертание — без fontWeight. */
  display: 'YesevaOne_400Regular',
};

const byWeight: Record<string, string> = {
  '100': F.regular, '200': F.regular, '300': F.regular, '400': F.regular, normal: F.regular,
  '500': F.medium, '600': F.semibold, '700': F.bold, '800': F.bold, '900': F.bold, bold: F.bold,
};

/**
 * Text с фирменным шрифтом. Кастомные шрифты в React Native не подбирают начертание
 * по fontWeight (на Android получается «фальшивый» жирный), поэтому выбираем файл
 * шрифта по весу сами. Если fontFamily задан явно (например, F.display) — он сохраняется.
 */
export function Text({ style, ...props }: TextProps) {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const fontFamily = flat.fontFamily ?? byWeight[String(flat.fontWeight ?? '400')] ?? F.regular;
  // В React 19 ref — обычный проп, он уходит в RNText вместе с остальными.
  return <RNText {...props} style={[style, { fontFamily, fontWeight: undefined }]} />;
}
