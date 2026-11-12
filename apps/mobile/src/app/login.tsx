import { Link, Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { Text } from '../components/Text';
import { Button, C, ErrorText, Field, Loading, Logo, Screen } from '../components/ui';
import { useAuth } from '../lib/auth';
import { SignedInGate } from '../components/SignedInGate';

/** Общий вход в демо-салон — данные там сбрасываются каждую ночь */
export const DEMO = { email: 'demo@salon.local', password: 'demo12345' };

export default function Login() {
  const { status, login, loginCode, me } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const params = useLocalSearchParams<{ demo?: string }>();
  const autoDemo = useRef(false);
  const [done, setDone] = useState(false);
  const [step2, setStep2] = useState<{ challenge: string; sentTo: string } | null>(null);
  const [code, setCode] = useState('');

  // Ссылка «Попробовать без регистрации» с главной: mioflow.ru → app.mioflow.ru/login?demo=1
  useEffect(() => {
    if (params.demo && status === 'guest' && !autoDemo.current) { autoDemo.current = true; void demo(); }
  }, [params.demo, status]);

  if (status === 'loading') return <Loading />;
  // Пришли по ссылке «демо», а вошли в свой аккаунт — спросим, а не покажем свои данные
  if (status === 'authed') return params.demo && !done && me?.tenant?.slug !== 'demo' ? <SignedInGate action="demo" /> : <Redirect href="/" />;

  async function submitCode() {
    if (!step2) return;
    setBusy(true);
    setError(null);
    try {
      setDone(true);
      await loginCode(step2.challenge, code);
    } catch (e) {
      setDone(false);
      setError(e);
      // Код сгорел или устарел — начинаем вход заново
      if ((e as Error).message.includes('заново')) { setStep2(null); setCode(''); }
    } finally {
      setBusy(false);
    }
  }

  async function demo() {
    setBusy(true);
    setError(null);
    try {
      setDone(true);
      await login(DEMO.email, DEMO.password);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      setDone(true);
      const r = await login(email.trim(), password);
      if (r.twoFactor) { setDone(false); setStep2(r.twoFactor); }
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
        <Text style={{ fontSize: 17, color: C.muted, marginBottom: 20, marginTop: 4 }}>Записи, клиенты и напоминания — для салона и частного мастера</Text>
        {step2 ? (
          <>
            <Text style={{ fontSize: 17, fontWeight: '700', color: C.text }}>Введите код входа</Text>
            <Text style={{ color: C.muted }}>Мы отправили 6 цифр {step2.sentTo === 'Telegram' ? 'в Telegram' : `на ${step2.sentTo}`}. Код действует 10 минут.</Text>
            <Field label="Код" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" placeholder="123456" onSubmitEditing={submitCode} autoFocus />
            <ErrorText error={error} />
            <Button title="Войти" onPress={submitCode} loading={busy} disabled={code.length !== 6} />
            <Text style={{ textAlign: 'center', color: C.muted, padding: 6 }} onPress={() => { setStep2(null); setCode(''); setError(null); }}>Назад</Text>
          </>
        ) : (<>
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="you@example.ru" />
        <Field label="Пароль" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" placeholder="••••••••" onSubmitEditing={submit} />
        <ErrorText error={error} />
        <Button title="Войти" onPress={submit} loading={busy} disabled={!email || !password} />
        <Button title="Посмотреть демо без регистрации" variant="ghost" onPress={demo} disabled={busy} />
        <Link href="/forgot" style={{ textAlign: 'center', color: C.muted, padding: 6 }}>Забыли пароль?</Link>
        <Link href="/register" style={{ textAlign: 'center', color: C.brand, fontWeight: '600', padding: 12 }}>
          Зарегистрироваться — 14 дней бесплатно
        </Link>
        </>)}
      </Screen>
    </KeyboardAvoidingView>
  );
}
