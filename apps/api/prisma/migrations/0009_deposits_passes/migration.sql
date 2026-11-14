-- Депозиты и абонементы. MioFlow ведёт только учёт: деньги принимает салон и сам выдаёт чек.

-- Баланс клиента: деньги (можно вернуть) и бонусы (не возвращаются), копейки
ALTER TABLE "Customer" ADD COLUMN "balance" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Customer" ADD COLUMN "bonus" INTEGER NOT NULL DEFAULT 0;

CREATE TYPE "AccountEntryType" AS ENUM ('TOPUP', 'CHARGE', 'REFUND', 'RETURN', 'ADJUST');

-- Журнал операций по балансу (только добавление)
CREATE TABLE "AccountEntry" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"   UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "customerId" UUID NOT NULL REFERENCES "Customer"("id") ON DELETE CASCADE,
  "type"       "AccountEntryType" NOT NULL,
  -- Со знаком: пополнение +, списание −
  "money"      INTEGER NOT NULL DEFAULT 0,
  "bonus"      INTEGER NOT NULL DEFAULT 0,
  "bookingId"  UUID REFERENCES "Booking"("id") ON DELETE SET NULL,
  -- cash | card | transfer | other
  "method"     TEXT,
  "userId"     UUID,
  "note"       TEXT,
  "createdAt"  TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX "AccountEntry_customer_idx" ON "AccountEntry"("tenantId", "customerId", "createdAt");
CREATE INDEX "AccountEntry_booking_idx" ON "AccountEntry"("bookingId");

CREATE TYPE "PassKind" AS ENUM ('VISITS', 'UNLIMITED');
CREATE TYPE "PassStatus" AS ENUM ('ACTIVE', 'USED', 'EXPIRED', 'CANCELLED');

-- Вид абонемента: «10 маникюров за 2 месяца», «безлимит на стрижки на месяц», «утренние визиты»
CREATE TABLE "PassPlan" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"     UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "name"         TEXT NOT NULL,
  "description"  TEXT,
  "kind"         "PassKind" NOT NULL,
  "visits"       INTEGER,
  "validityDays" INTEGER NOT NULL,
  "price"        INTEGER NOT NULL,
  -- Какие услуги покрывает (пусто — любые)
  "serviceIds"   UUID[] NOT NULL DEFAULT '{}',
  -- Временное окно: { "days": [1..7], "from": "10:00", "to": "16:00" } — только в эти часы
  "timeRule"     JSONB,
  "isPublic"     BOOLEAN NOT NULL DEFAULT true,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "PassPlan_visits_check" CHECK (("kind" = 'VISITS' AND "visits" > 0) OR ("kind" = 'UNLIMITED' AND "visits" IS NULL))
);
CREATE INDEX "PassPlan_tenantId_idx" ON "PassPlan"("tenantId");

-- Абонемент клиента (условия копируются из вида на момент продажи)
CREATE TABLE "CustomerPass" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"    UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "customerId"  UUID NOT NULL REFERENCES "Customer"("id") ON DELETE CASCADE,
  "planId"      UUID REFERENCES "PassPlan"("id") ON DELETE SET NULL,
  "name"        TEXT NOT NULL,
  "kind"        "PassKind" NOT NULL,
  "visitsTotal" INTEGER,
  "visitsLeft"  INTEGER,
  "serviceIds"  UUID[] NOT NULL DEFAULT '{}',
  "timeRule"    JSONB,
  "price"       INTEGER NOT NULL,
  "method"      TEXT,
  "startsAt"    TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "expiresAt"   TIMESTAMPTZ(3) NOT NULL,
  "status"      "PassStatus" NOT NULL DEFAULT 'ACTIVE',
  "userId"      UUID,
  "createdAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX "CustomerPass_customer_idx" ON "CustomerPass"("tenantId", "customerId", "status");

-- Визит, оплаченный абонементом
CREATE TABLE "PassUse" (
  "id"        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"  UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "passId"    UUID NOT NULL REFERENCES "CustomerPass"("id") ON DELETE CASCADE,
  "bookingId" UUID NOT NULL UNIQUE REFERENCES "Booking"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX "PassUse_pass_idx" ON "PassUse"("passId");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['AccountEntry','PassPlan','CustomerPass','PassUse'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO salon_app', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $p$, t);
  END LOOP;
END $$;

-- Журнал денег не переписывается задним числом
REVOKE UPDATE, DELETE ON "AccountEntry" FROM salon_app;
