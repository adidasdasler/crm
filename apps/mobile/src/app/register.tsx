import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { Button, C, ErrorText, Field, Muted, Screen } from '../components/ui';
import { ApiError, get, PUBLIC_WEB_URL } from '../lib/api';
import { useAuth } from '../lib/auth';

const translit = (s: string) => {
  const map: Record<string, string> = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
  return s.toLowerCase().split('').map((c) => map[c] ?? c).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
};

export default function Register() {
  const { status, register } = useAuth();
  const [f, setF] = useState({ salonName: '', name: '', phone: '', email: '', password: '', slug: '' });
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugFree, setSlugFree] = useState<boolean | null>(null);
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!slugTouched) setF((x) => ({ ...x, slug: translit(x.salonName) }));
  }, [f.salonName, slugTouched]);
  useEffect(() => {
    if (f.slug.length < 3) return setSlugFree(null);
    const t = setTimeout(() => get<{ available: boolean }>(`/auth/check-slug?slug=${f.slug}`).then((r) => setSlugFree(r.available)).catch(() => null), 400);
    return () => clearTimeout(t);
  }, [f.slug]);

  if (status === 'authed') return <Redirect href="/" />;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
      await register({ ...f, email: f.email.trim(), phone: f.phone || undefined, timezone, acceptTerms: accept });
    } catch (e) {
      const ae = e as ApiError;
      const details = (ae.details as { fieldErrors?: Record<string, string[]> })?.fieldErrors;
      setError(details ? new Error(Object.values(details).flat().join('\n')) : e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Field label="Название салона" value={f.salonName} onChangeText={set('salonName')} placeholder="Студия «Лаванда»" />
      <Field
        label="Адрес страницы записи"
        value={f.slug}
        onChangeText={(v) => { setSlugTouched(true); set('slug')(v.toLowerCase()); }}
        autoCapitalize="none"
        error={slugFree === false ? 'Адрес занят' : undefined}
      />
      <Muted>{PUBLIC_WEB_URL.replace(/^https?:\/\//, '')}/b/{f.slug || '…'}</Muted>
      <Field label="Ваше имя" value={f.name} onChangeText={set('name')} autoComplete="name" />
      <Field label="Телефон" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" placeholder="+7 999 123-45-67" />
      <Field label="Email" value={f.email} onChangeText={set('email')} autoCapitalize="none" keyboardType="email-address" />
      <Field label="Пароль (минимум 8 символов)" value={f.password} onChangeText={set('password')} secureTextEntry />
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 4 }}>
        <Pressable onPress={() => setAccept(!accept)} hitSlop={8} style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: accept ? C.brand : C.border, backgroundColor: accept ? C.brand : '#fff', alignItems: 'center', justifyContent: 'center' }}>
          {accept && <Text style={{ color: '#fff', fontWeight: '800' }}>✓</Text>}
        </Pressable>
        <Text style={{ flex: 1, color: C.muted }} onPress={() => setAccept(!accept)}>
          Принимаю <Text style={{ color: C.brand }} onPress={() => Linking.openURL(`${PUBLIC_WEB_URL}/terms`)}>оферту</Text> и даю согласие на{' '}
          <Text style={{ color: C.brand }} onPress={() => Linking.openURL(`${PUBLIC_WEB_URL}/privacy`)}>обработку персональных данных</Text>
        </Text>
      </View>
      <ErrorText error={error} />
      <Button title="Создать салон" onPress={submit} loading={busy} disabled={!accept || !f.salonName || !f.email || f.password.length < 8 || slugFree === false} />
    </Screen>
  );
}
