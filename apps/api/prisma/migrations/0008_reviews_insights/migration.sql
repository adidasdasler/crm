-- Оценка визита клиентом (1–5) и комментарий. Одна оценка на запись.
CREATE TABLE "Review" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"   UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "bookingId"  UUID NOT NULL UNIQUE REFERENCES "Booking"("id") ON DELETE CASCADE,
  "customerId" UUID NOT NULL REFERENCES "Customer"("id") ON DELETE CASCADE,
  "resourceId" UUID NOT NULL REFERENCES "Resource"("id") ON DELETE CASCADE,
  "rating"     SMALLINT NOT NULL CHECK ("rating" BETWEEN 1 AND 5),
  "comment"    TEXT,
  "source"     TEXT NOT NULL,
  "createdAt"  TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt"  TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX "Review_tenant_idx" ON "Review"("tenantId", "createdAt");
CREATE INDEX "Review_resource_idx" ON "Review"("tenantId", "resourceId");

GRANT SELECT, INSERT, UPDATE, DELETE ON "Review" TO salon_app;
ALTER TABLE "Review" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Review" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Review"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Когда владельцу последний раз отправлена еженедельная сводка с советами
ALTER TABLE "Tenant" ADD COLUMN "insightsSentAt" TIMESTAMPTZ(3);
