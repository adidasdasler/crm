-- Онлайн-предоплата: деньги идут напрямую в магазин ЮKassa салона (не через владельца сервиса)
CREATE TABLE "TenantPaymentSettings" (
  "tenantId"  UUID PRIMARY KEY REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "enabled"   BOOLEAN NOT NULL DEFAULT false,
  -- percent: процент от цены записи; fixed: фиксированная сумма (копейки)
  "mode"      TEXT NOT NULL DEFAULT 'percent',
  "value"     INTEGER NOT NULL DEFAULT 30,
  "shopId"    TEXT,
  -- Секретный ключ ЮKassa салона, зашифрован AES-256-GCM (src/common/secret-box.ts)
  "secretEnc" TEXT,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TYPE "BookingPaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'CANCELED');
CREATE TABLE "BookingPayment" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"        UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "bookingId"       UUID NOT NULL REFERENCES "Booking"("id") ON DELETE CASCADE,
  "amount"          INTEGER NOT NULL,
  "status"          "BookingPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "externalId"      TEXT UNIQUE,
  "confirmationUrl" TEXT,
  "createdAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "paidAt"          TIMESTAMPTZ(3)
);
CREATE INDEX "BookingPayment_booking_idx" ON "BookingPayment"("tenantId", "bookingId");
CREATE INDEX "BookingPayment_pending_idx" ON "BookingPayment"("status", "createdAt");

GRANT SELECT, INSERT, UPDATE, DELETE ON "TenantPaymentSettings", "BookingPayment" TO salon_app;
ALTER TABLE "TenantPaymentSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantPaymentSettings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantPaymentSettings"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE "BookingPayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BookingPayment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BookingPayment"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
