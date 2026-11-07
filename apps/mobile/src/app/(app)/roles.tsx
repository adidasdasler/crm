import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Switch, View } from 'react-native';
import { Text } from '../../components/Text';
import { C, Card, ErrorText, Loading, Muted, Screen } from '../../components/ui';
import { get, put } from '../../lib/api';
import { useMe } from '../../lib/auth';
import type { Perm, Role } from '../../lib/types';

type Matrix = {
  permissions: { key: Perm; label: string }[];
  roles: { role: Role; label: string; editable: boolean; granted: Perm[] }[];
};

const HINT: Partial<Record<Role, string>> = {
  MANAGER: 'Управляет салоном вместо вас. Оплата подписки — только у владельца.',
  ADMIN: 'Ведёт запись и клиентов на ресепшене.',
  MASTER: 'Работает со своими записями. Без «всех записей» видит только себя.',
};

/** Владелец решает, кто что видит. Изменения применяются в течение пары минут. */
export default function Roles() {
  const me = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['permissions'], queryFn: () => get<Matrix>('/tenant/permissions') });
  const save = useMutation({
    mutationFn: (v: { role: Role; key: Perm; on: boolean }) => put<Matrix>('/tenant/permissions', { permissions: { [v.role]: { [v.key]: v.on } } }),
    onSuccess: (m) => qc.setQueryData(['permissions'], m),
  });
  if (q.isLoading) return <Loading />;
  const owner = me.role === 'OWNER';

  return (
    <Screen>
      <Muted>Права действуют в приложении и в веб-версии. Владелец всегда видит всё.</Muted>
      <ErrorText error={q.error ?? save.error} />
      {q.data?.roles.filter((r) => r.editable).map((r) => (
        <Card key={r.role}>
          <Text style={{ fontSize: 18, fontWeight: '700' }}>{r.label}</Text>
          {HINT[r.role] && <Muted>{HINT[r.role]}</Muted>}
          {q.data!.permissions.map((p, i) => {
            const on = r.granted.includes(p.key);
            return (
              <View key={p.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: C.border }}>
                <Text style={{ flex: 1 }}>{p.label}</Text>
                <Switch
                  value={on}
                  disabled={!owner || save.isPending}
                  onValueChange={(v) => save.mutate({ role: r.role, key: p.key, on: v })}
                  trackColor={{ true: C.brand, false: C.border }}
                  thumbColor="#FFFFFF"
                  {...({ activeThumbColor: '#FFFFFF' } as object)}
                  accessibilityLabel={`${r.label}: ${p.label}`}
                />
              </View>
            );
          })}
        </Card>
      ))}
    </Screen>
  );
}
