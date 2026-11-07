-- ═══════════════════════════════════════════════════════════════════
-- 0002: изоляция тенантов (RLS), защита от пересечения записей,
--       частичные уникальные индексы, роль приложения.
-- ═══════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ─── Роль приложения ───────────────────────────────────────────────
-- Приложение работает от salon_app: НЕ владелец таблиц, НЕ суперпользователь,
-- без BYPASSRLS — значит, RLS действует всегда. Пароль задаётся при деплое
-- (deploy/postgres/init.sh): ALTER ROLE salon_app LOGIN PASSWORD '...'.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'salon_app') THEN
    CREATE ROLE salon_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO salon_app;

-- Платформенные таблицы: ограниченный доступ.
GRANT SELECT, UPDATE ON "Tenant" TO salon_app;
GRANT SELECT ON "Plan" TO salon_app;
-- Пароли и токены приложению недоступны: auth работает через системное подключение.
GRANT SELECT ("id", "email", "name", "phone") ON "User" TO salon_app;

-- Таблицы салона: полный CRUD, но только в своём тенанте.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Membership','Subscription','Payment','Resource','TimeOff','ServiceCategory',
    'Service','ServiceResource','Customer','Booking','BookingItem','Reminder','AuditLog'
  ] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO salon_app', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    -- Пустой/не заданный app.tenant_id → NULL → ни одна строка не видна.
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $p$, t);
  END LOOP;
END $$;

-- Аудит — только добавление.
REVOKE UPDATE, DELETE ON "AuditLog" FROM salon_app;

-- ─── Запрет пересечения записей у одного мастера ───────────────────
ALTER TABLE "Booking" ADD CONSTRAINT booking_no_overlap
  EXCLUDE USING gist (
    "tenantId" WITH =,
    "resourceId" WITH =,
    tstzrange("startsAt", "blockedUntil", '[)') WITH &&
  ) WHERE (status NOT IN ('CANCELLED', 'NO_SHOW'));

ALTER TABLE "Booking" ADD CONSTRAINT booking_time_valid
  CHECK ("startsAt" < "endsAt" AND "endsAt" <= "blockedUntil");

ALTER TABLE "TimeOff" ADD CONSTRAINT timeoff_time_valid CHECK ("startsAt" < "endsAt");

ALTER TABLE "Service" ADD CONSTRAINT service_values_valid
  CHECK (price >= 0 AND duration > 0 AND "bufferTime" >= 0);

-- ─── Уникальность с учётом мягкого удаления ────────────────────────
CREATE UNIQUE INDEX customer_tenant_phone_active
  ON "Customer" ("tenantId", phone) WHERE "deletedAt" IS NULL;
