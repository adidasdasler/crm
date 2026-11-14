import { useState } from 'react';
import { Text } from '../../components/Text';
import { Button, C, Card, ErrorText, Field, Muted, Screen } from '../../components/ui';
import { post } from '../../lib/api';
import { useAuth, useMe } from '../../lib/auth';

/** Удаление аккаунта прямо в приложении (требование App Store и Google Play). */
export default function DeleteAccount() {
  const me = useMe();
  const { logout } = useAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const owner = me.role === 'OWNER';

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await post('/me/delete', { password });
      // Полный выход: токены, кэш профиля и офлайн-данные
      await logout();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Card style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca' }}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: C.danger }}>Это действие нельзя отменить</Text>
        {owner ? (
          <Muted>
            Вместе с аккаунтом будет удалён салон «{me.tenant.name}»: онлайн-запись перестанет работать, сотрудники потеряют доступ.
            Все данные (клиенты, записи, услуги) будут окончательно стёрты через 30 дней. Перед удалением выгрузите клиентов: «Ещё → Выгрузить клиентов».
          </Muted>
        ) : (
          <Muted>Вы потеряете доступ к салонам, в которых работаете. Данные салонов останутся у их владельцев.</Muted>
        )}
      </Card>
      <Field label="Введите пароль для подтверждения" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
      <ErrorText error={error} />
      <Button title="Удалить аккаунт навсегда" variant="danger" onPress={submit} loading={busy} disabled={!password} />
    </Screen>
  );
}
