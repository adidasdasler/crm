import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { Text } from '../../components/Text';
import { Button, C, Card, ErrorText, H, Loading, Muted, s, Screen, Toggle } from '../../components/ui';
import { get, patch } from '../../lib/api';
import type { Tenant } from '../../lib/types';

type Audience = { total: number; consent: number; reachable: number; lapsed: number; defaults: { winback: string; birthday: string } };

/** Возврат клиентов: «давно не были» и поздравления с днём рождения */
export default function Winback() {
  const qc = useQueryClient();
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: () => get<Tenant>('/tenant') });
  const aud = useQuery({ queryKey: ['marketing', 'audience'], queryFn: () => get<Audience>('/marketing/audience') });
  const [f, setF] = useState({ winbackEnabled: false, winbackDays: '45', winbackText: '', birthdayEnabled: false, birthdayText: '' });
  useEffect(() => {
    const st = tenant.data?.settings;
    if (st) setF({ winbackEnabled: !!st.winbackEnabled, winbackDays: String(st.winbackDays ?? 45), winbackText: st.winbackText ?? '', birthdayEnabled: !!st.birthdayEnabled, birthdayText: st.birthdayText ?? '' });
  }, [tenant.data]);
  const save = useMutation({
    mutationFn: () => patch('/tenant', { settings: {
      winbackEnabled: f.winbackEnabled, winbackDays: Math.min(365, Math.max(14, parseInt(f.winbackDays, 10) || 45)),
      winbackText: f.winbackText.trim(), birthdayEnabled: f.birthdayEnabled, birthdayText: f.birthdayText.trim(),
    } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['tenant'] }); void qc.invalidateQueries({ queryKey: ['marketing'] }); router.back(); },
  });
  if (tenant.isLoading) return <Loading />;
  const a = aud.data;

  return (
    <Screen>
      <Muted>Автоматические сообщения клиентам, которые дали согласие на рассылку (галочка при онлайн-записи или в карточке клиента). Приходят в Telegram, MAX, ВКонтакте или на email — днём, с 11 до 20. В каждом сообщении есть ссылка «отписаться».</Muted>
      {a && (
        <Card>
          <Text style={{ fontWeight: '700', color: C.text }}>Кому можно писать</Text>
          <Muted>Всего клиентов: {a.total} · дали согласие: {a.consent} · из них с подключённым мессенджером или email: {a.reachable}</Muted>
          {f.winbackEnabled && <Muted>Сейчас «давно не были» ({f.winbackDays} дн.): {a.lapsed}</Muted>}
        </Card>
      )}

      <H>Давно не были</H>
      <Toggle label="Напоминать о себе" hint="Один раз после долгой паузы, если клиент ещё не записан" value={f.winbackEnabled} onChange={(v) => setF({ ...f, winbackEnabled: v })} />
      {f.winbackEnabled && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: C.text }}>Через</Text>
            <TextInput value={f.winbackDays} onChangeText={(v) => setF({ ...f, winbackDays: v.replace(/\D/g, '').slice(0, 3) })} keyboardType="number-pad" style={[s.input, { width: 70, paddingVertical: 8, textAlign: 'center' }]} />
            <Text style={{ color: C.text }}>дней после визита</Text>
          </View>
          <TextInput value={f.winbackText} onChangeText={(v) => setF({ ...f, winbackText: v })} placeholder={a?.defaults.winback} multiline maxLength={500} style={[s.input, { minHeight: 90, textAlignVertical: 'top' }]} />
        </>
      )}

      <H>День рождения</H>
      <Toggle label="Поздравлять с днём рождения" hint="Если в карточке клиента указана дата рождения" value={f.birthdayEnabled} onChange={(v) => setF({ ...f, birthdayEnabled: v })} />
      {f.birthdayEnabled && (
        <TextInput value={f.birthdayText} onChangeText={(v) => setF({ ...f, birthdayText: v })} placeholder={a?.defaults.birthday} multiline maxLength={500} style={[s.input, { minHeight: 90, textAlignVertical: 'top' }]} />
      )}
      <Muted>В тексте можно использовать {'{имя}'} и {'{салон}'}. Пустое поле — стандартный текст (серым). Ссылка на запись добавится сама.</Muted>
      <ErrorText error={save.error ?? tenant.error} />
      <Button title="Сохранить" onPress={() => save.mutate()} loading={save.isPending} />
    </Screen>
  );
}
