import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ReactNode } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ComponentProps } from 'react';
import { F, Text } from '../components/Text';
import { Button, C, Chip, ErrorText, Field, Muted, Screen } from '../components/ui';
import { ApiError, get, PUBLIC_WEB_URL } from '../lib/api';
import { useAuth } from '../lib/auth';
import { SignedInGate } from '../components/SignedInGate';
import type { IndustryInfo } from '../lib/types';

const translit = (s: string) => {
  const map: Record<string, string> = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
  return s.toLowerCase().split('').map((c) => map[c] ?? c).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
};

type Kind = 'solo' | 'salon';

export default function Register() {
  const { status, register } = useAuth();
  // Ссылка с сайта может сразу выбрать вариант: /register?kind=solo
  const params = useLocalSearchParams<{ kind?: string }>();
  const [kind, setKind] = useState<Kind | null>(params.kind === 'solo' || params.kind === 'salon' ? params.kind : null);
  const [f, setF] = useState({ salonName: '', name: '', phone: '', email: '', password: '', slug: '' });
  const [industry, setIndustry] = useState('beauty');
  const [industries, setIndustries] = useState<IndustryInfo[]>([]);
  useEffect(() => { get<IndustryInfo[]>('/public-meta/industries').then(setIndustries).catch(() => null); }, []);
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugFree, setSlugFree] = useState<boolean | null>(null);
  const [accept, setAccept] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!slugTouched) setF((x) => ({ ...x, slug: translit(kind === 'solo' ? x.salonName || x.name : x.salonName) }));
  }, [f.salonName, f.name, kind, slugTouched]);
  useEffect(() => {
    if (f.slug.length < 3) return setSlugFree(null);
    const t = setTimeout(() => get<{ available: boolean }>(`/auth/check-slug?slug=${f.slug}`).then((r) => setSlugFree(r.available)).catch(() => null), 400);
    return () => clearTimeout(t);
  }, [f.slug]);

  // Только что зарегистрировались — в приложение; уже были в аккаунте — спросим, а не перебросим молча
  if (status === 'authed') return done ? <Redirect href="/" /> : <SignedInGate action="register" />;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
      setDone(true);
      await register({
        ...f, kind, email: f.email.trim(), phone: f.phone || undefined, timezone, industry, acceptTerms: accept, acceptPrivacy,
        // Частному мастеру название и адрес не обязательны: возьмём имя, свободный адрес подберёт сервер
        salonName: f.salonName.trim() || (kind === 'solo' ? undefined : f.salonName), slug: f.slug || undefined,
      });
    } catch (e) {
      const ae = e as ApiError;
      const details = (ae.details as { fieldErrors?: Record<string, string[]> })?.fieldErrors;
      setError(details ? new Error(Object.values(details).flat().join('\n')) : e);
    } finally {
      setBusy(false);
    }
  }

  if (!kind) {
    return (
      <Screen>
        <Text style={{ fontSize: 26, fontFamily: F.display }}>Кто вы?</Text>
        <Muted>От этого зависит, что будет в приложении. Поменять можно позже.</Muted>
        <KindCard icon="person-outline" title="Я частный мастер" text="Работаю один: дома, в аренде кресла или кабинета. Нужны запись, клиенты и напоминания." onPress={() => setKind('solo')} />
        <KindCard icon="people-outline" title="У меня салон или студия" text="Несколько мастеров, администратор, графики и права доступа." onPress={() => setKind('salon')} />
      </Screen>
    );
  }
  const solo = kind === 'solo';

  return (
    <Screen>
      <Pressable onPress={() => setKind(null)} accessibilityRole="button"><Text style={{ color: C.brand, fontWeight: '600' }}>← {solo ? 'Частный мастер' : 'Салон или студия'} · изменить</Text></Pressable>
      {industries.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 13, color: C.muted, fontWeight: '600' }}>Чем вы занимаетесь</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {industries.map((i) => <Chip key={i.code} label={i.label} active={industry === i.code} onPress={() => setIndustry(i.code)} />)}
          </View>
          <Muted>Добавим типовые услуги с ценами — их можно поменять. Медицинские услуги не поддерживаются.</Muted>
        </View>
      )}
      <Field label="Ваше имя" value={f.name} onChangeText={set('name')} autoComplete="name" placeholder="Анна Смирнова" />
      <Field label={solo ? 'Название (необязательно)' : 'Название салона'} value={f.salonName} onChangeText={set('salonName')} placeholder={solo ? 'Например, «Ногти by Анна» — иначе будет ваше имя' : 'Студия «Лаванда»'} />
      <Field
        label="Адрес страницы записи"
        value={f.slug}
        onChangeText={(v) => { setSlugTouched(true); set('slug')(v.toLowerCase()); }}
        autoCapitalize="none"
        error={slugFree === false ? (kind === 'solo' ? 'Адрес занят — подберём похожий автоматически' : 'Адрес занят') : undefined}
      />
      <Muted>{PUBLIC_WEB_URL.replace(/^https?:\/\//, '')}/b/{f.slug || '…'}</Muted>
      <Field label="Телефон" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" placeholder="+7 999 123-45-67" />
      <Field label="Email" value={f.email} onChangeText={set('email')} autoCapitalize="none" keyboardType="email-address" />
      <Field label="Пароль (минимум 8 символов)" value={f.password} onChangeText={set('password')} secureTextEntry />
      <Check value={accept} onChange={setAccept}>
        Принимаю условия <Text style={{ color: C.brand }} onPress={() => Linking.openURL(`${PUBLIC_WEB_URL}/terms`)}>оферты</Text>
      </Check>
      <Check value={acceptPrivacy} onChange={setAcceptPrivacy}>
        Даю <Text style={{ color: C.brand }} onPress={() => Linking.openURL(`${PUBLIC_WEB_URL}/consent`)}>согласие на обработку персональных данных</Text> в соответствии с{' '}
        <Text style={{ color: C.brand }} onPress={() => Linking.openURL(`${PUBLIC_WEB_URL}/privacy`)}>политикой</Text>
      </Check>
      <ErrorText error={error} />
      <Button
        title={solo ? 'Начать работу' : 'Создать салон'}
        onPress={submit}
        loading={busy}
        disabled={!accept || !acceptPrivacy || f.name.trim().length < 2 || (!solo && f.salonName.trim().length < 2) || !f.email.includes('@') || f.password.length < 8 || (slugFree === false && !solo)}
      />
      {f.name.trim().length < 2 && <Muted>Укажите имя — его увидят клиенты.</Muted>}
    </Screen>
  );
}

/** Чекбокс: нажатие на квадрат или на текст (кроме ссылок) переключает его */
function Check({ value, onChange, children }: { value: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 4 }}>
      <Pressable onPress={() => onChange(!value)} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: value }}
        style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: value ? C.brand : C.border, backgroundColor: value ? C.brand : '#fff', alignItems: 'center', justifyContent: 'center' }}>
        {value && <Text style={{ color: '#fff', fontWeight: '800' }}>✓</Text>}
      </Pressable>
      <Text style={{ flex: 1, color: C.muted }} onPress={() => onChange(!value)}>{children}</Text>
    </View>
  );
}

function KindCard({ icon, title, text, onPress }: { icon: ComponentProps<typeof Ionicons>['name']; title: string; text: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
      <View style={{ backgroundColor: C.card, borderRadius: 22, padding: 18, borderWidth: 1, borderColor: '#EEF0F7', flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: C.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={26} color={C.brand} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ fontSize: 18, fontWeight: '700' }}>{title}</Text>
          <Text style={{ color: C.muted }}>{text}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={C.muted} />
      </View>
    </Pressable>
  );
}
