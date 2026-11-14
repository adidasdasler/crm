-- Лист ожидания: клиент просит сообщить, когда в выбранный день освободится время
CREATE TYPE "WaitlistStatus" AS ENUM ('ACTIVE', 'NOTIFIED', 'DONE', 'CANCELLED', 'EXPIRED');

CREATE TABLE "WaitlistEntry" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"   UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "name"       TEXT NOT NULL,
  "phone"      TEXT NOT NULL,
  "email"      TEXT,
  "serviceIds" UUID[] NOT NULL,
  "resourceId" UUID REFERENCES "Resource"("id") ON DELETE SET NULL,
  -- День визита по времени салона
  "date"       DATE NOT NULL,
  "status"     "WaitlistStatus" NOT NULL DEFAULT 'ACTIVE',
  "notifiedAt" TIMESTAMPTZ(3),
  "createdAt"  TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX "WaitlistEntry_tenant_date_idx" ON "WaitlistEntry"("tenantId", "date", "status");
CREATE INDEX "WaitlistEntry_active_idx" ON "WaitlistEntry"("status", "date");

GRANT SELECT, INSERT, UPDATE, DELETE ON "WaitlistEntry" TO salon_app;
ALTER TABLE "WaitlistEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WaitlistEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WaitlistEntry"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
