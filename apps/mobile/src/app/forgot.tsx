import { useState } from 'react';
import { Text } from 'react-native';
import { Button, C, Card, ErrorText, Field, Muted, Screen } from '../components/ui';
import { post } from '../lib/api';

export default function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await post('/auth/forgot', { email: email.trim() });
      setSent(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      {sent ? (
        <Card>
          <Text style={{ fontSize: 17, fontWeight: '700', color: C.text }}>Проверьте почту</Text>
          <Muted>Если {email} зарегистрирован, мы отправили на него ссылку для нового пароля. Она действует 1 час. Не пришло — загляните в «Спам».</Muted>
        </Card>
      ) : (
        <>
          <Muted>Укажите email, с которым входите в Salon, — пришлём ссылку для нового пароля.</Muted>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="Email для входа" onSubmitEditing={submit} />
          <ErrorText error={error} />
          <Button title="Отправить ссылку" onPress={submit} loading={busy} disabled={!email.includes('@')} />
        </>
      )}
    </Screen>
  );
}
