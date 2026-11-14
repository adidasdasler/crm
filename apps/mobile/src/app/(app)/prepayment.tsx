import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { Text } from '../../components/Text';
import { Button, C, Card, Chip, ErrorText, Field, H, Loading, Muted, Screen, Toggle } from '../../components/ui';
import { get, PUBLIC_WEB_URL, put } from '../../lib/api';
import { rub } from '../../lib/format';

type Settings = { enabled: boolean; mode: 'percent' | 'fixed'; value: number; shopId: string | null; hasSecret: boolean };

/** Онлайн-предоплата: деньги клиента идут сразу в магазин ЮKassa салона */
export default function Prepayment() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['prepayment'], queryFn: () => get<Settings>('/prepayment/settings') });
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<'percent' | 'fixed'>('percent');
  const [value, setValue] = useState('30');
  const [shopId, setShopId] = useState('');
  const [secret, setSecret] = useState('');
  useEffect(() => {
    if (!q.data) return;
    setEnabled(q.data.enabled); setMode(q.data.mode); setShopId(q.data.shopId ?? '');
    setValue(String(q.data.mode === 'fixed' ? q.data.value / 100 : q.data.value));
  }, [q.data]);
  const n = Math.max(0, parseInt(value.replace(/\D/g, ''), 10) || 0);
  const save = useMutation({
    mutationFn: () => put('/prepayment/settings', {
      enabled, mode, value: mode === 'fixed' ? n * 100 : Math.min(100, Math.max(1, n)),
      ...(shopId.trim() ? { shopId: shopId.trim() } : {}), ...(secret.trim() ? { secretKey: secret.trim() } : {}),
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['prepayment'] }); router.back(); },
  });
  if (q.isLoading) return <Loading />;
  const webhook = `${PUBLIC_WEB_URL}/v1/webhooks/yookassa-salon`;

  return (
    <Screen>
      <Muted>Клиент вносит предоплату картой или через СБП сразу при онлайн-записи. Неявок становится заметно меньше. Без оплаты запись отменяется через 20 минут, и время снова свободно.</Muted>
      <Card>
        <Text style={{ fontWeight: '700', color: C.text }}>Деньги идут напрямую вам</Text>
        <Muted>Оплата проходит через ваш собственный магазин в ЮKassa — деньги поступают на ваш счёт, MioFlow их не получает и не хранит. Чеки по 54-ФЗ включаются в настройках вашего магазина ЮKassa. Возврат предоплаты при отмене — по вашим правилам, в кабинете ЮKassa.</Muted>
        <Text style={{ color: C.brand, fontWeight: '600' }} onPress={() => Linking.openURL('https://yookassa.ru/joinups')}>Подключить ЮKassa →</Text>
      </Card>

      <Toggle label="Брать предоплату при онлайн-записи" value={enabled} onChange={setEnabled} />
      <H>Сколько</H>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip label="Процент от цены" active={mode === 'percent'} onPress={() => { setMode('percent'); setValue('30'); }} />
        <Chip label="Фиксированная сумма" active={mode === 'fixed'} onPress={() => { setMode('fixed'); setValue('500'); }} />
      </View>
      <Field label={mode === 'percent' ? 'Процент, %' : 'Сумма, ₽'} value={value} onChangeText={setValue} keyboardType="number-pad" />
      <Muted>{mode === 'percent' ? `Например, услуга за 2 000 ₽ → предоплата ${rub(Math.round((200000 * Math.min(100, n)) / 100 / 100) * 100)}` : `Не больше цены услуги`}</Muted>

      <H>Ключи магазина ЮKassa</H>
      <Muted>Личный кабинет ЮKassa → «Интеграция» → «Ключи API». Ключ хранится в зашифрованном виде и больше никому не показывается.</Muted>
      <Field label="shopId" value={shopId} onChangeText={setShopId} keyboardType="number-pad" placeholder="123456" />
      <Field label={q.data?.hasSecret ? 'Секретный ключ (сохранён — введите, чтобы заменить)' : 'Секретный ключ'} value={secret} onChangeText={setSecret} secureTextEntry autoCapitalize="none" placeholder="live_…" />
      <Card>
        <Text style={{ fontWeight: '700', color: C.text }}>HTTP-уведомления</Text>
        <Muted>В кабинете ЮKassa → «Интеграция» → «HTTP-уведомления» укажите адрес и событие payment.succeeded:</Muted>
        <Text selectable style={{ color: C.text, fontWeight: '600' }}>{webhook}</Text>
        <Muted>Без этого оплата тоже отметится — когда клиент вернётся на страницу записи, — но с уведомлениями надёжнее.</Muted>
      </Card>
      <ErrorText error={save.error ?? q.error} />
      <Button title="Сохранить" onPress={() => save.mutate()} loading={save.isPending} />
    </Screen>
  );
}
