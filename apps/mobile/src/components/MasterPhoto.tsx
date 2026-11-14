import { useQueryClient } from '@tanstack/react-query';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, Platform, Pressable, View } from 'react-native';
import { Text } from './Text';
import { C, ErrorText, Muted } from './ui';
import { API_URL, del, upload } from '../lib/api';
import { confirm } from '../lib/confirm';

/** Полный адрес картинки: в вебе хватает пути /v1/…, в приложении нужен адрес сервера */
export const photoSrc = (path: string | null | undefined) =>
  path ? { uri: API_URL.startsWith('http') ? API_URL.replace(/\/v1$/, '') + path : path } : null;

/** Круглое фото мастера или первая буква имени на его цвете */
export function MasterAvatar({ url, name, color, size = 40 }: { url?: string | null; name: string; color: string; size?: number }) {
  const src = photoSrc(url);
  if (src) return <Image source={src} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.brandSoft }} accessibilityLabel={`Фото: ${name}`} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.42 }}>{name.trim().slice(0, 1).toUpperCase() || '?'}</Text>
    </View>
  );
}

/** Квадрат по центру, 800 px, JPEG — пересжатие заодно убирает метаданные (координаты съёмки) */
async function pickSquare(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted && Platform.OS !== 'web') throw new Error('Нет доступа к фото — разрешите его в настройках телефона');
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: false, allowsEditing: Platform.OS !== 'web', aspect: [1, 1] });
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  const side = Math.min(a.width, a.height);
  const out = await ImageManipulator.manipulateAsync(a.uri, [
    { crop: { originX: Math.floor((a.width - side) / 2), originY: Math.floor((a.height - side) / 2), width: side, height: side } },
    { resize: { width: Math.min(800, side) } },
  ], { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG });
  return out.uri;
}

/** Фото мастера в карточке: загрузить, сменить, удалить */
export function MasterPhotoEditor({ id, url, name, color }: { id: string; url: string | null | undefined; name: string; color: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['resource', id] }); void qc.invalidateQueries({ queryKey: ['resources'] }); };

  async function choose() {
    setError(null);
    try {
      const uri = await pickSquare();
      if (!uri) return;
      setBusy(true);
      const form = new FormData();
      if (Platform.OS === 'web') form.append('photo', await (await fetch(uri)).blob(), 'photo.jpg');
      else form.append('photo', { uri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);
      await upload(`/resources/${id}/photo`, form);
      refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!(await confirm('Удалить фото?', 'Клиенты будут видеть первую букву имени.', 'Удалить'))) return;
    await del(`/resources/${id}/photo`).catch(setError);
    refresh();
  }

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <MasterAvatar url={url} name={name} color={color} size={72} />
        <View style={{ flex: 1, gap: 6 }}>
          <Pressable onPress={choose} disabled={busy}><Text style={{ color: C.brand, fontWeight: '600' }}>{busy ? 'Загружаем…' : url ? 'Сменить фото' : 'Загрузить фото'}</Text></Pressable>
          {url && <Pressable onPress={remove}><Text style={{ color: C.muted }}>Удалить фото</Text></Pressable>}
        </View>
      </View>
      <Muted>Фото видят клиенты при онлайн-записи. Загружайте фото мастера только с его согласия.</Muted>
      <ErrorText error={error} />
    </View>
  );
}
