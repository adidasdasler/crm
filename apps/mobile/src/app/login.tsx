import { Link, Redirect } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { Text } from '../components/Text';
import { Button, C, ErrorText, Field, Loading, Logo, Screen } from '../components/ui';
import { useAuth } from '../lib/auth';

export default function Login() {
  const { status, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (status === 'loading') return <Loading />;
  if (status === 'authed') return <Redirect href="/" />;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <View style={{ height: 64 }} />
        <Logo size={48} />
        <Text style={{ fontSize: 17, color: C.muted, marginBottom: 20, marginTop: 4 }}>Онлайн-запись, клиенты и напоминания для вашего салона</Text>
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="you@example.ru" />
        <Field label="Пароль" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" placeholder="••••••••" onSubmitEditing={submit} />
        <ErrorText error={error} />
        <Button title="Войти" onPress={submit} loading={busy} disabled={!email || !password} />
        <Link href="/forgot" style={{ textAlign: 'center', color: C.muted, padding: 6 }}>Забыли пароль?</Link>
        <Link href="/register" style={{ textAlign: 'center', color: C.brand, fontWeight: '600', padding: 12 }}>
          Создать салон — 14 дней бесплатно
        </Link>
      </Screen>
    </KeyboardAvoidingView>
  );
}
