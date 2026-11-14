import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, View } from 'react-native';
import { Text } from '../../../components/Text';
import { Button, C, Chip, ErrorText, Field, H, Muted, Screen, Toggle } from '../../../components/ui';
import { get } from '../../../lib/api';
import { can, useMe } from '../../../lib/auth';
import { pickPhoto, Prepared, uploadDesign } from '../../../lib/designs';
import { useOnline } from '../../../lib/offline';
import type { Material } from '../../../lib/types';

/** Новое фото работы. bookingId — из карточки записи: клиент, мастер и услуга подставятся сами. */
export default function NewDesign() {
  const { bookingId } = useLocalSearchParams<{ bookingId?: string }>();
  const me = useMe();
  const qc = useQueryClient();
  const online = useOnline();
  const [photo, setPhoto] = useState<Prepared | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [f, setF] = useState({ title: '', tags: [] as string[], tag: '', materialIds: [] as string[], note: '', isPublic: false });
  const tags = useQuery({ queryKey: ['designs', 'tags'], queryFn: () => get<{ tag: string; count: number }[]>('/designs/tags') });
  const materials = useQuery({ queryKey: ['stock', 'materials'], queryFn: () => get<Material[]>('/stock/materials'), enabled: can(me, 'stock.manage') || can(me, 'catalog.manage') });

  const pick = async (src: 'camera' | 'library') => {
    setErr(null);
    try { const p = await pickPhoto(src); if (p) setPhoto(p); } catch (e) { setErr(e); }
  };
  const addTag = (t: string) => {
    const v = t.trim().toLowerCase().slice(0, 30);
    if (v && !f.tags.includes(v)) setF({ ...f, tags: [...f.tags, v].slice(0, 15), tag: '' });
    else setF({ ...f, tag: '' });
  };
  const save = useMutation({
    mutationFn: () => uploadDesign(photo!, {
      title: f.title || null, tags: f.tag.trim() ? [...f.tags, f.tag.trim().toLowerCase()] : f.tags, materialIds: f.materialIds,
      materialNote: f.note || null, isPublic: f.isPublic, ...(bookingId ? { bookingId } : {}),
    }),
    onSuccess: (d) => { qc.invalidateQueries({ queryKey: ['designs'] }); router.replace(`/designs/${d.id}`); },
  });

  return (
    <Screen>
      {!photo ? (
        <View style={{ gap: 10 }}>
          <Muted>{bookingId ? 'Фото привяжется к визиту: в карточке клиента будет видно, что делали в прошлый раз.' : 'Сфотографируйте работу или выберите фото из галереи.'}</Muted>
          <Button icon="camera-outline" title="Сфотографировать" onPress={() => pick('camera')} />
          <Button variant="ghost" icon="images-outline" title="Выбрать из галереи" onPress={() => pick('library')} />
          <Muted>Лицо клиента в кадр лучше не брать: для публикации фото с лицом нужно отдельное согласие человека.</Muted>
        </View>
      ) : (
        <>
          <Image source={{ uri: photo.thumb }} style={{ width: '100%', aspectRatio: photo.width / photo.height, borderRadius: 18, backgroundColor: C.brandSoft }} resizeMode="cover" />
          <Button variant="ghost" title="Другое фото" onPress={() => setPhoto(null)} />
          <Field label="Название" value={f.title} onChangeText={(title) => setF({ ...f, title })} placeholder="Френч с блёстками" />
          <H>Теги</H>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {f.tags.map((t) => <Chip key={t} label={`${t} ✕`} active onPress={() => setF({ ...f, tags: f.tags.filter((x) => x !== t) })} />)}
            {(tags.data ?? []).filter((t) => !f.tags.includes(t.tag)).slice(0, 12).map((t) => <Chip key={t.tag} label={`+ ${t.tag}`} onPress={() => addTag(t.tag)} />)}
          </View>
          <Field value={f.tag} onChangeText={(tag) => setF({ ...f, tag })} placeholder="Новый тег: френч, нюд, омбре…" onSubmitEditing={() => addTag(f.tag)} returnKeyType="done" />
          {(materials.data?.length ?? 0) > 0 && (
            <>
              <H>Материалы</H>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {materials.data!.filter((m) => m.isActive).map((m) => (
                  <Chip key={m.id} label={m.name} active={f.materialIds.includes(m.id)} onPress={() => setF({ ...f, materialIds: f.materialIds.includes(m.id) ? f.materialIds.filter((x) => x !== m.id) : [...f.materialIds, m.id] })} />
                ))}
              </View>
            </>
          )}
          <Field label="Заметка мастеру" value={f.note} onChangeText={(note) => setF({ ...f, note })} multiline placeholder="Номера оттенков, техника, сколько времени заняло" />
          {can(me, 'catalog.manage') && <Toggle label="Показать в портфолио на сайте" hint="Фото увидят клиенты на странице записи" value={f.isPublic} onChange={(isPublic) => setF({ ...f, isPublic })} />}
          {!online && <Text style={{ color: '#9A6B00' }}>Нет интернета — загрузить фото можно, когда появится связь.</Text>}
          <ErrorText error={err ?? save.error} />
          <Button title="Сохранить" onPress={() => save.mutate()} loading={save.isPending} disabled={!online} />
        </>
      )}
      {!photo && <ErrorText error={err} />}
    </Screen>
  );
}
