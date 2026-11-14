import { router } from 'expo-router';
import { useState } from 'react';
import { Text } from '../../components/Text';
import { Button, C, Card, ErrorText, Field, Muted, Screen } from '../../components/ui';
import { post } from '../../lib/api';
import { useAuth, useMe } from '../../lib/auth';

/** Вход с кодом (второй фактор): после пароля — 6 цифр в MAX, Telegram, ВКонтакте или на email */
export default function TwoFactor() {
  const me = useMe();
  const { reload } = useAuth();
  const on = !!me.twoFactor?.enabled;
  const channels = me.twoFactor?.channels ?? [];
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await post('/auth/two-factor', { enabled: !on, password });
      await reload();
      router.back();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Card>
        <Text style={{ fontSize: 17, fontWeight: '700', color: C.text }}>{on ? 'Вход с кодом включён' : 'Зачем это нужно'}</Text>
        <Muted>
          {on
            ? 'После пароля приложение просит 6-значный код. Даже если пароль узнают, без кода в аккаунт и базу клиентов не войти.'
            : 'Пароль можно подсмотреть или подобрать. С кодом войти сможете только вы: после пароля придёт 6-значный код.'}
        </Muted>
        <Muted>
          Куда придёт код: {channels.length ? channels.map((c) => (c === 'max' ? 'MAX' : c === 'telegram' ? 'Telegram' : c === 'vk' ? 'ВКонтакте' : `email ${me.user.email}`)).join(', затем ') : 'пока некуда — подключите «Уведомления в MAX», «во ВКонтакте» или «в Telegram» в разделе «Ещё»'}.
        </Muted>
      </Card>
      <Field label="Пароль для подтверждения" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
      <ErrorText error={error} />
      <Button title={on ? 'Выключить вход с кодом' : 'Включить вход с кодом'} variant={on ? 'ghost' : 'primary'} onPress={submit} loading={busy} disabled={!password || (!on && !channels.length)} />
    </Screen>
  );
}
