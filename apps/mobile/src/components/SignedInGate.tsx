import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from './Text';
import { Button, C, Card, Loading, Logo, Muted, Screen } from './ui';
import { useAuth } from '../lib/auth';

/**
 * Пользователь уже вошёл, а пришёл по ссылке «регистрация» или «демо» с сайта.
 * Раньше его молча перебрасывало в свой кабинет — теперь спрашиваем.
 * Из демо выходим без вопросов: там нечего терять.
 */
export function SignedInGate({ action }: { action: 'register' | 'demo' }) {
  const { me, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const inDemo = me?.tenant?.slug === 'demo';
  useEffect(() => { if (inDemo) void logout(); }, [inDemo, logout]);
  if (inDemo) return <Loading />;

  return (
    <Screen>
      <View style={{ height: 48 }} />
      <Logo size={40} />
      <Card>
        <Text style={{ fontSize: 17, fontWeight: '700', color: C.text }}>Вы уже вошли</Text>
        <Muted>
          {me?.user.name}{me?.tenant?.name && me.tenant.name !== me.user.name ? ` · ${me.tenant.name}` : ''} ({me?.user.email}). {action === 'register'
            ? 'Чтобы зарегистрировать новый салон или частного мастера, сначала выйдите из этого аккаунта.'
            : 'Чтобы посмотреть демо-салон, выйдите из своего аккаунта — потом войдёте обратно своим email и паролем.'}
        </Muted>
      </Card>
      <Button
        title={action === 'register' ? 'Выйти и зарегистрироваться' : 'Выйти и открыть демо'}
        loading={busy}
        onPress={async () => { setBusy(true); await logout(); setBusy(false); }}
      />
      <Button title="Вернуться в свой кабинет" variant="ghost" onPress={() => router.replace('/')} />
    </Screen>
  );
}
