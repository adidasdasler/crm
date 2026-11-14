-- Склад материалов. Количества хранятся целыми числами в тысячных долях единицы (1 мл = 1000),
-- чтобы не было ошибок округления: 0,5 мл геля = 500.
CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'SERVICE', 'WRITE_OFF', 'ADJUST', 'RETURN');

CREATE TABLE "Material" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"    UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "name"        TEXT NOT NULL,
  "unit"        TEXT NOT NULL DEFAULT 'шт',
  "category"    TEXT,
  -- Текущий остаток (может уйти в минус, если списали больше, чем оприходовали)
  "stock"       INTEGER NOT NULL DEFAULT 0,
  -- «Заканчивается», когда остаток ≤ этого порога
  "minStock"    INTEGER NOT NULL DEFAULT 0,
  -- Последняя цена закупки за единицу, копейки
  "lastCost"    INTEGER NOT NULL DEFAULT 0,
  "trackExpiry" BOOLEAN NOT NULL DEFAULT false,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "deletedAt"   TIMESTAMPTZ(3)
);
CREATE INDEX "Material_tenantId_idx" ON "Material"("tenantId");

-- Партия: приход с одной ценой и одним сроком годности. Расход идёт с партий, срок которых истекает раньше (FEFO).
CREATE TABLE "MaterialBatch" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"    UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "materialId"  UUID NOT NULL REFERENCES "Material"("id") ON DELETE CASCADE,
  "qty"         INTEGER NOT NULL,
  "remaining"   INTEGER NOT NULL,
  "costPerUnit" INTEGER NOT NULL DEFAULT 0,
  "expiresAt"   DATE,
  "receivedAt"  TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "MaterialBatch_remaining_check" CHECK ("remaining" >= 0 AND "remaining" <= "qty")
);
CREATE INDEX "MaterialBatch_material_idx" ON "MaterialBatch"("tenantId", "materialId", "expiresAt");

-- Журнал движений: каждый приход, расход на визит, списание и инвентаризация
CREATE TABLE "StockMovement" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"    UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "materialId"  UUID NOT NULL REFERENCES "Material"("id") ON DELETE CASCADE,
  "batchId"     UUID REFERENCES "MaterialBatch"("id") ON DELETE SET NULL,
  "type"        "StockMovementType" NOT NULL,
  -- Со знаком: приход +, расход −
  "qty"         INTEGER NOT NULL,
  "costPerUnit" INTEGER NOT NULL DEFAULT 0,
  "bookingId"   UUID REFERENCES "Booking"("id") ON DELETE SET NULL,
  "userId"      UUID,
  "note"        TEXT,
  "createdAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX "StockMovement_material_idx" ON "StockMovement"("tenantId", "materialId", "createdAt");
CREATE INDEX "StockMovement_booking_idx" ON "StockMovement"("bookingId");

-- Норма расхода материала на услугу
CREATE TABLE "ServiceMaterial" (
  "tenantId"   UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "serviceId"  UUID NOT NULL REFERENCES "Service"("id") ON DELETE CASCADE,
  "materialId" UUID NOT NULL REFERENCES "Material"("id") ON DELETE CASCADE,
  "qty"        INTEGER NOT NULL CHECK ("qty" > 0),
  PRIMARY KEY ("serviceId", "materialId")
);
CREATE INDEX "ServiceMaterial_tenantId_idx" ON "ServiceMaterial"("tenantId");

-- Изоляция салонов, как у остальных таблиц (см. 0002)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Material','MaterialBatch','StockMovement','ServiceMaterial'] LOOP
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

-- Журнал движений не переписывается задним числом
REVOKE UPDATE, DELETE ON "StockMovement" FROM salon_app;
