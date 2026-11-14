import type { Role } from '@prisma/client';
import { z } from 'zod';

/**
 * Права доступа. Роль задаёт набор по умолчанию, владелец может включать и выключать
 * права для ролей MANAGER, ADMIN и MASTER в настройках «Роли и доступы».
 * OWNER всегда имеет все права; оплата подписки — только владелец.
 */
export const PERMISSIONS = {
  'bookings.all': 'Видеть и вести записи всех мастеров',
  'customers.view': 'Открывать всю базу клиентов',
  'customers.contacts': 'Видеть телефоны и email клиентов',
  'customers.export': 'Выгружать клиентов в Excel',
  'catalog.manage': 'Редактировать услуги и цены',
  'staff.manage': 'Редактировать мастеров и графики',
  'stock.manage': 'Склад: приход, списание, инвентаризация',
  'finance.manage': 'Депозиты и абонементы: пополнение, продажа, возврат',
  'team.manage': 'Приглашать сотрудников и менять их доступ',
  'settings.manage': 'Настройки салона и онлайн-записи',
  'analytics.view': 'Отчёты: выручка, загрузка, источники',
} as const;
export type Perm = keyof typeof PERMISSIONS;
export const PERM_KEYS = Object.keys(PERMISSIONS) as Perm[];
export const CONFIGURABLE_ROLES = ['MANAGER', 'ADMIN', 'MASTER'] as const;
export type ConfigurableRole = (typeof CONFIGURABLE_ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = { OWNER: 'Владелец', MANAGER: 'Управляющий', ADMIN: 'Администратор', MASTER: 'Мастер' };

const all = (v: boolean) => Object.fromEntries(PERM_KEYS.map((k) => [k, v])) as Record<Perm, boolean>;

export const DEFAULT_PERMISSIONS: Record<ConfigurableRole, Record<Perm, boolean>> = {
  MANAGER: all(true),
  ADMIN: {
    ...all(false),
    'bookings.all': true, 'customers.view': true, 'customers.contacts': true, 'catalog.manage': true, 'staff.manage': true, 'stock.manage': true, 'finance.manage': true,
  },
  // Мастер по умолчанию видит только свои записи и клиентов из них (с контактами, чтобы позвонить).
  MASTER: { ...all(false), 'customers.contacts': true },
};

export const permissionsSchema = z.partialRecord(z.enum(CONFIGURABLE_ROLES), z.partialRecord(z.enum(PERM_KEYS as [Perm, ...Perm[]]), z.boolean()));
export type PermissionOverrides = z.infer<typeof permissionsSchema>;

/** Итоговый набор прав роли с учётом настроек салона */
export function resolvePermissions(role: Role, overrides?: PermissionOverrides): Set<Perm> {
  if (role === 'OWNER') return new Set(PERM_KEYS);
  const merged = { ...DEFAULT_PERMISSIONS[role], ...(overrides?.[role] ?? {}) };
  return new Set(PERM_KEYS.filter((k) => merged[k]));
}

/** Полная матрица для экрана «Роли и доступы» */
export function permissionMatrix(overrides?: PermissionOverrides) {
  return {
    permissions: PERM_KEYS.map((key) => ({ key, label: PERMISSIONS[key] })),
    roles: (['OWNER', ...CONFIGURABLE_ROLES] as Role[]).map((role) => ({
      role, label: ROLE_LABELS[role], editable: role !== 'OWNER', granted: [...resolvePermissions(role, overrides)],
    })),
  };
}

/** «+7 *** ***-45-67» — для ролей без права на контакты */
export const maskPhone = (p?: string | null) => (p ? `${p.slice(0, 2)} *** ***-${p.slice(-4, -2)}-${p.slice(-2)}` : p);
export const maskEmail = (e?: string | null) => (e ? `${e[0]}***@${e.split('@')[1] ?? ''}` : e);
