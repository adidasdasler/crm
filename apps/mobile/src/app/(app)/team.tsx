import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { Text } from '../../components/Text';
import { Button, C, Card, Chip, ErrorText, Field, H, Muted, Screen } from '../../components/ui';
import { router } from 'expo-router';
import { del, get, patch, post } from '../../lib/api';
import { useMe } from '../../lib/auth';
import type { Resource, Role } from '../../lib/types';

type Member = { id: string; role: Role; resourceId: string | null; user: { id: string; name: string; email: string } };
const ROLES: Record<Role, string> = { OWNER: 'Владелец', MANAGER: 'Управляющий', ADMIN: 'Администратор', MASTER: 'Мастер' };

export default function Team() {
  const me = useMe();
  const qc = useQueryClient();
  const team = useQuery({ queryKey: ['team'], queryFn: () => get<Member[]>('/team') });
  const resources = useQuery({ queryKey: ['resources'], queryFn: () => get<Resource[]>('/resources') });
  const [f, setF] = useState({ name: '', email: '', role: 'MASTER' as Exclude<Role, 'OWNER'>, resourceId: null as string | null });

  const invite = useMutation({
    mutationFn: () => post<{ tempPassword?: string; user: { email: string } }>('/team', f),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['team'] });
      setF({ name: '', email: '', role: 'MASTER', resourceId: null });
      const msg = r.tempPassword
        ? `Передайте сотруднику данные для входа в приложение:\n\nEmail: ${r.user.email}\nПароль: ${r.tempPassword}\n\nПароль показывается один раз.`
        : 'Сотрудник уже зарегистрирован — салон появится у него в приложении.';
      Platform.OS === 'web' ? alert(msg) : Alert.alert('Сотрудник добавлен', msg);
    },
  });
  const change = useMutation({
    mutationFn: (v: { id: string; role: Exclude<Role, 'OWNER'>; resourceId?: string | null }) => patch(`/team/${v.id}`, { role: v.role, resourceId: v.resourceId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
  });
  const [editing, setEditing] = useState<string | null>(null);
  const owner = me.role === 'OWNER';
  // Управляющего назначает только владелец
  const assignable = (owner ? ['MASTER', 'ADMIN', 'MANAGER'] : ['MASTER', 'ADMIN']) as Exclude<Role, 'OWNER'>[];
  const remove = useMutation({ mutationFn: (id: string) => del(`/team/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }) });

  return (
    <Screen>
      {(team.data ?? []).map((m) => (
        <Card key={m.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: '600' }}>{m.user.name}</Text>
              <Muted>{m.user.email} · {ROLES[m.role]}</Muted>
            </View>
            {m.role !== 'OWNER' && m.user.id !== me.user.id && (owner || m.role !== 'MANAGER') && (
              <View style={{ flexDirection: 'row', gap: 14 }}>
                <Text style={{ color: C.brand, fontWeight: '600' }} onPress={() => setEditing(editing === m.id ? null : m.id)}>Роль</Text>
                <Text style={{ color: C.danger, fontWeight: '600' }} onPress={() => remove.mutate(m.id)}>Убрать</Text>
              </View>
            )}
          </View>
          {editing === m.id && (
            <View style={{ gap: 8, marginTop: 6 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {assignable.map((r) => <Chip key={r} label={ROLES[r]} active={m.role === r} onPress={() => change.mutate({ id: m.id, role: r })} />)}
              </View>
              <Muted>Связать с мастером в календаре:</Muted>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {(resources.data ?? []).map((r) => (
                  <Chip key={r.id} label={r.name} color={r.color} active={m.resourceId === r.id} onPress={() => change.mutate({ id: m.id, role: m.role as Exclude<Role, 'OWNER'>, resourceId: m.resourceId === r.id ? null : r.id })} />
                ))}
              </View>
            </View>
          )}
        </Card>
      ))}

      {owner && <Button variant="ghost" icon="shield-checkmark-outline" title="Настроить права ролей" onPress={() => router.push('/roles')} />}
      <ErrorText error={change.error} />
      <H>Добавить сотрудника</H>
      <Field label="Имя" value={f.name} onChangeText={(name) => setF({ ...f, name })} />
      <Field label="Email" value={f.email} onChangeText={(email) => setF({ ...f, email })} autoCapitalize="none" keyboardType="email-address" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {assignable.map((r) => <Chip key={r} label={ROLES[r]} active={f.role === r} onPress={() => setF({ ...f, role: r })} />)}
      </View>
      <Muted>
        {f.role === 'MASTER' ? 'Мастер видит только свои записи.' : f.role === 'ADMIN' ? 'Администратор ведёт записи всех мастеров, клиентов и услуги.' : 'Управляющий — всё, кроме оплаты подписки.'}
      </Muted>
      {f.role === 'MASTER' && (
        <>
          <Muted>Какой мастер в календаре — этот сотрудник:</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(resources.data ?? []).map((r) => <Chip key={r.id} label={r.name} color={r.color} active={f.resourceId === r.id} onPress={() => setF({ ...f, resourceId: r.id })} />)}
          </View>
        </>
      )}
      <ErrorText error={invite.error ?? remove.error} />
      <Button title="Добавить" onPress={() => invite.mutate()} loading={invite.isPending} disabled={!f.name || !f.email || (f.role === 'MASTER' && !f.resourceId)} />
    </Screen>
  );
}
