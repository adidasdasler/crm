import { useQueryClient } from '@tanstack/react-query';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, Linking, Platform, Pressable, View } from 'react-native';
import { Text } from './Text';
import { C, ErrorText, Muted, Toggle } from './ui';
import { API_URL, del, PUBLIC_WEB_URL, upload } from '../lib/api';
import { confirm } from '../lib/confirm';
import { uriToBlob } from '../lib/fileBlob';

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
export function MasterPhotoEditor({ id, url, name, color, own, consentAt }: { id: string; url: string | null | undefined; name: string; color: string; own: boolean; consentAt?: string | null }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const consent = own ? 'self' : 'written';
  const [error, setError] = useState<unknown>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['resource', id] }); void qc.invalidateQueries({ queryKey: ['resources'] }); };

  async function choose() {
    setError(null);
    try {
      const uri = await pickSquare();
      if (!uri) return;
      setBusy(true);
      const form = new FormData();
      form.append('consent', consent);
      if (Platform.OS === 'web') form.append('photo', await uriToBlob(uri), 'photo.jpg');
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
          <Pressable onPress={choose} disabled={busy || !agreed} accessibilityState={{ disabled: busy || !agreed }}>
            <Text style={{ color: agreed ? C.brand : C.muted, fontWeight: '600' }}>{busy ? 'Загружаем…' : url ? 'Сменить фото' : 'Загрузить фото'}</Text>
          </Pressable>
          {url && <Pressable onPress={remove}><Text style={{ color: C.muted }}>Удалить фото</Text></Pressable>}
        </View>
      </View>
      {own ? (
        <Toggle value={agreed} onChange={setAgreed} label="Согласен(на) показывать фото клиентам"
          hint="Фото, имя и должность будут видны на странице онлайн-записи салона. Согласие можно отозвать в любой момент — просто удалите фото." />
      ) : (
        <>
          <Toggle value={agreed} onChange={setAgreed} label="У меня есть письменное согласие мастера"
            hint="Показ фото с именем клиентам — распространение персональных данных: нужно отдельное письменное согласие мастера (ст. 10.1 закона № 152-ФЗ)." />
          <Pressable onPress={() => void Linking.openURL(`${PUBLIC_WEB_URL}/master-photo-consent`)}>
            <Text style={{ color: C.brand }}>Бланк согласия — распечатать и подписать</Text>
          </Pressable>
        </>
      )}
      {url && consentAt && <Muted>Согласие подтверждено {new Date(consentAt).toLocaleDateString('ru-RU')}</Muted>}
      <ErrorText error={error} />
    </View>
  );
}
