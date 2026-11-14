import * as ImageManipulator from 'expo-image-manipulator';
import { uriToBlob } from './fileBlob';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { API_URL, tokens, upload } from './api';
import type { Design } from './types';

export type Prepared = { full: string; thumb: string; width: number; height: number };

/**
 * Выбрать фото (камера или галерея) и подготовить на устройстве: до 1600 px по большей стороне
 * и миниатюра 480 px, JPEG 82%. Пересжатие заодно убирает EXIF с координатами съёмки.
 */
export async function pickPhoto(source: 'camera' | 'library'): Promise<Prepared | null> {
  const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted && Platform.OS !== 'web') throw new Error(source === 'camera' ? 'Нет доступа к камере — разрешите его в настройках телефона' : 'Нет доступа к фото — разрешите его в настройках телефона');
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false, allowsEditing: false };
  const r = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  const fit = (max: number) => (a.width >= a.height ? { width: Math.min(max, a.width) } : { height: Math.min(max, a.height) });
  const full = await ImageManipulator.manipulateAsync(a.uri, [{ resize: fit(1600) }], { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG });
  const thumb = await ImageManipulator.manipulateAsync(a.uri, [{ resize: fit(480) }], { compress: 0.78, format: ImageManipulator.SaveFormat.JPEG });
  return { full: full.uri, thumb: thumb.uri, width: full.width, height: full.height };
}

async function part(form: FormData, name: string, uri: string) {
  if (Platform.OS === 'web') form.append(name, await uriToBlob(uri), `${name}.jpg`);
  // В React Native файл передаётся объектом { uri, name, type }
  else form.append(name, { uri, name: `${name}.jpg`, type: 'image/jpeg' } as unknown as Blob);
}

export async function uploadDesign(p: Prepared, meta: Record<string, unknown>) {
  const form = new FormData();
  await part(form, 'image', p.full);
  await part(form, 'thumb', p.thumb);
  form.append('data', JSON.stringify(meta));
  return upload<Design>('/designs', form);
}

/** Источник картинки: в приложении — с токеном в заголовке, в вебе — по cookie */
export async function imageSource(id: string, size: 'thumb' | 'full') {
  const uri = `${API_URL}/designs/${id}/image/${size}`;
  if (Platform.OS === 'web') return { uri };
  return { uri, headers: { Authorization: `Bearer ${await tokens.access()}` } };
}
