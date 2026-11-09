import { useEffect, useState } from 'react';
import { Image, ImageStyle, StyleProp, View } from 'react-native';
import { imageSource } from '../lib/designs';
import { C } from './ui';

/** Фото из библиотеки дизайнов (с авторизацией). Пока источник готовится — серая подложка. */
export function DesignImage({ id, size = 'thumb', style }: { id: string; size?: 'thumb' | 'full'; style?: StyleProp<ImageStyle> }) {
  const [src, setSrc] = useState<{ uri: string; headers?: Record<string, string> } | null>(null);
  useEffect(() => {
    let alive = true;
    void imageSource(id, size).then((s) => { if (alive) setSrc(s); });
    return () => { alive = false; };
  }, [id, size]);
  if (!src) return <View style={[{ backgroundColor: C.brandSoft }, style as object]} />;
  return <Image source={src} style={[{ backgroundColor: C.brandSoft }, style]} resizeMode="cover" accessibilityIgnoresInvertColors />;
}
