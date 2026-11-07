import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Button, C, Card, ErrorText, Field, Muted, Screen } from '../components/ui';
import { post } from '../lib/api';

/** Открывается по ссылке из письма: {APP_URL}/reset?token=… */
export default function Reset() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await post('/auth/reset', { token, password });
      setDone(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <Screen><ErrorText error={new Error('Ссылка неполная. Откройте её из письма ещё раз')} /></Screen>;
  return (
    <Screen>
      {done ? (
        <Card>
          <Text style={{ fontSize: 17, fontWeight: '700', color: C.text }}>Пароль изменён</Text>
          <Muted>Все прежние входы завершены. Войдите с новым паролем.</Muted>
          <Button title="Войти" onPress={() => router.replace('/login')} style={{ marginTop: 8 }} />
        </Card>
      ) : (
        <>
          <Field label="Новый пароль (минимум 8 символов)" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" placeholder="Новый пароль" />
          <Field label="Повторите пароль" value={repeat} onChangeText={setRepeat} secureTextEntry placeholder="Ещё раз" error={repeat && repeat !== password ? 'Пароли не совпадают' : undefined} />
          <ErrorText error={error} />
          <Button title="Сохранить пароль" onPress={submit} loading={busy} disabled={password.length < 8 || password !== repeat} />
        </>
      )}
    </Screen>
  );
}
