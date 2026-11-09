import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, useWindowDimensions, View } from 'react-native';
import { DesignImage } from '../../../components/DesignImage';
import { Text } from '../../../components/Text';
import { C, Chip, Empty, ErrorText, Fab, Field, webMax } from '../../../components/ui';
import { get } from '../../../lib/api';
import type { Design } from '../../../lib/types';

/** Библиотека дизайнов: фото работ мастеров, поиск по тегам («френч», «нюд»), портфолио для сайта */
export default function Designs() {
  const { width } = useWindowDimensions();
  const [tag, setTag] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const tags = useQuery({ queryKey: ['designs', 'tags'], queryFn: () => get<{ tag: string; count: number }[]>('/designs/tags') });
  const list = useQuery({
    queryKey: ['designs', 'list', tag, q],
    queryFn: () => get<Design[]>(`/designs?limit=120${tag ? `&tag=${encodeURIComponent(tag)}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  });
  const cols = width >= 900 ? 5 : width >= 600 ? 4 : 3;
  const size = (Math.min(width, 760) - 32 - (cols - 1) * 6) / cols;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <FlatList
        data={list.data ?? []}
        key={cols}
        numColumns={cols}
        keyExtractor={(d) => d.id}
        columnWrapperStyle={{ gap: 6 }}
        contentContainerStyle={[webMax, { padding: 16, gap: 6, paddingBottom: 100 }]}
        ListHeaderComponent={
          <View style={{ gap: 10, marginBottom: 6 }}>
            <Field value={q} onChangeText={setQ} placeholder="Поиск: название или тег" />
            {(tags.data?.length ?? 0) > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <Chip label="Все" active={!tag} onPress={() => setTag(null)} />
                {tags.data!.slice(0, 20).map((t) => <Chip key={t.tag} label={`${t.tag} · ${t.count}`} active={tag === t.tag} onPress={() => setTag(tag === t.tag ? null : t.tag)} />)}
              </View>
            )}
            <ErrorText error={list.error} />
          </View>
        }
        ListEmptyComponent={list.isLoading ? undefined : <Empty icon="images-outline" text={'Здесь будут фото ваших работ.\nДобавляйте их после визита — потом легко найти «тот самый дизайн» и показать новым клиентам.'} />}
        renderItem={({ item: d }) => (
          <Pressable onPress={() => router.push(`/designs/${d.id}`)} accessibilityRole="imagebutton" accessibilityLabel={d.title ?? 'Фото работы'}>
            <DesignImage id={d.id} style={{ width: size, height: size, borderRadius: 14 }} />
            {d.isPublic && (
              <View style={{ position: 'absolute', top: 6, left: 6, backgroundColor: C.accent, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 }}>
                <Text style={{ fontSize: 10, fontWeight: '700' }}>на сайте</Text>
              </View>
            )}
          </Pressable>
        )}
      />
      <Fab icon="camera" label="Добавить фото" onPress={() => router.push('/designs/new')} />
    </View>
  );
}
