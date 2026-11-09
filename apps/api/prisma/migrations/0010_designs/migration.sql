-- Библиотека дизайнов: фото работ мастеров с тегами и использованными материалами.
-- Можно привязать к визиту клиента («что делали в прошлый раз») и показать в портфолио на мини-сайте.
CREATE TABLE "Design" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"    UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "title"       TEXT,
  "tags"        TEXT[] NOT NULL DEFAULT '{}',
  "serviceId"   UUID REFERENCES "Service"("id") ON DELETE SET NULL,
  "resourceId"  UUID REFERENCES "Resource"("id") ON DELETE SET NULL,
  "bookingId"   UUID REFERENCES "Booking"("id") ON DELETE SET NULL,
  "customerId"  UUID REFERENCES "Customer"("id") ON DELETE SET NULL,
  "materialIds" UUID[] NOT NULL DEFAULT '{}',
  "materialNote" TEXT,
  -- Показывать в портфолио на странице записи салона
  "isPublic"    BOOLEAN NOT NULL DEFAULT false,
  -- Ключи файлов в хранилище (полный размер и миниатюра)
  "fileKey"     TEXT NOT NULL,
  "thumbKey"    TEXT NOT NULL,
  "width"       INTEGER,
  "height"      INTEGER,
  "createdById" UUID,
  "createdAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX "Design_tenant_idx" ON "Design"("tenantId", "createdAt");
CREATE INDEX "Design_customer_idx" ON "Design"("tenantId", "customerId");
CREATE INDEX "Design_tags_idx" ON "Design" USING gin ("tags");

GRANT SELECT, INSERT, UPDATE, DELETE ON "Design" TO salon_app;
ALTER TABLE "Design" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Design" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Design"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
