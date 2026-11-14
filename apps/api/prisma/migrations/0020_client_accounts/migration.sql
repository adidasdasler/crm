-- Кабинет клиента на mioflow.ru: свои записи во всех салонах на любом устройстве.
-- Оператор этих аккаунтов — владелец сервиса MioFlow (отдельное согласие клиента).
CREATE TABLE "ClientUser" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "email"           TEXT UNIQUE,
  "emailVerifiedAt" TIMESTAMPTZ(3),
  "passwordHash"    TEXT,
  "name"            TEXT NOT NULL,
  "phone"           TEXT,
  "phoneVerifiedAt" TIMESTAMPTZ(3),
  "yandexId"        TEXT UNIQUE,
  "vkId"            TEXT UNIQUE,
  -- Увеличивается при смене пароля и выходе со всех устройств: старые сессии перестают действовать
  "sessionVersion"  INTEGER NOT NULL DEFAULT 0,
  "verifyHash"      TEXT UNIQUE,
  "resetHash"       TEXT UNIQUE,
  "resetExpires"    TIMESTAMPTZ(3),
  "failedAttempts"  INTEGER NOT NULL DEFAULT 0,
  "lockedUntil"     TIMESTAMPTZ(3),
  "consentVersion"  TEXT,
  "createdAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "lastLoginAt"     TIMESTAMPTZ(3)
);
CREATE INDEX "ClientUser_phone_idx" ON "ClientUser"("phone");
REVOKE ALL ON "ClientUser" FROM salon_app;

-- Клиент салона, записавшийся из кабинета (или привязавший запись), — связь с аккаунтом
ALTER TABLE "Customer" ADD COLUMN "clientUserId" UUID REFERENCES "ClientUser"("id") ON DELETE SET NULL;
CREATE INDEX "Customer_clientUser_idx" ON "Customer"("clientUserId");
