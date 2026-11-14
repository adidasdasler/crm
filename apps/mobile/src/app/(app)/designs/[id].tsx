import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { DesignImage } from '../../../components/DesignImage';
import { Text } from '../../../components/Text';
import { Button, C, Card, Chip, ErrorText, Field, Loading, Muted, Screen, Toggle } from '../../../components/ui';
import { del, get, patch } from '../../../lib/api';
import { can, useMe } from '../../../lib/auth';
import type { Design } from '../../../lib/types';

export default function DesignScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['designs', 'one', id], queryFn: () => get<Design>(`/designs/${id}`) });
  const [tags, setTags] = useState('');
  useEffect(() => { if (q.data) setTags(q.data.tags.join(', ')); }, [q.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['designs'] });
  const save = useMutation({
    mutationFn: (body: Partial<Design>) => patch(`/designs/${id}`, body),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: () => del(`/designs/${id}`), onSuccess: () => { refresh(); router.back(); } });
  if (!q.data) return q.error ? <Screen><ErrorText error={q.error} /></Screen> : <Loading />;
  const d = q.data;
  const askRemove = () => {
    if (Platform.OS === 'web') { if (confirm('Удалить фото?')) remove.mutate(); return; }
    Alert.alert('Удалить фото?', undefined, [{ text: 'Отмена', style: 'cancel' }, { text: 'Удалить', style: 'destructive', onPress: () => remove.mutate() }]);
  };

  return (
    <Screen>
      <DesignImage id={d.id} size="full" style={{ width: '100%', aspectRatio: d.width && d.height ? d.width / d.height : 1, borderRadius: 18 }} />
      <Card>
        {d.title && <Text style={{ fontSize: 18, fontWeight: '700' }}>{d.title}</Text>}
        <Muted>{[d.master && `Мастер: ${d.master}`, d.service, new Date(d.createdAt).toLocaleDateString('ru-RU')].filter(Boolean).join(' · ')}</Muted>
        {d.customer && d.customerId && <Text style={{ color: C.brand, fontWeight: '600' }} onPress={() => router.push(`/customer/${d.customerId}`)}>Клиент: {d.customer} →</Text>}
        {d.bookingId && <Text style={{ color: C.brand }} onPress={() => router.push(`/booking/${d.bookingId}`)}>Открыть визит →</Text>}
        {d.tags.length > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{d.tags.map((t) => <Chip key={t} label={t} />)}</View>}
        {(d.materials?.length ?? 0) > 0 && <Muted>Материалы: {d.materials!.map((m) => m.name).join(', ')}</Muted>}
        {d.materialNote && <Muted>Заметка: {d.materialNote}</Muted>}
      </Card>
      {d.canEdit && (
        <Card>
          <Field label="Теги через запятую" value={tags} onChangeText={setTags} onBlur={() => save.mutate({ tags: tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean) })} />
          {can(me, 'catalog.manage') && <Toggle label="В портфолио на сайте" value={d.isPublic} onChange={(isPublic) => save.mutate({ isPublic })} />}
          <ErrorText error={save.error ?? remove.error} />
          <Button variant="danger" title="Удалить фото" onPress={askRemove} loading={remove.isPending} />
        </Card>
      )}
    </Screen>
  );
}
