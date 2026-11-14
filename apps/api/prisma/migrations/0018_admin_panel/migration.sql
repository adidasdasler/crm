-- Отдельная панель владельца сервиса: свои аккаунты (не пользователи салонов) и очередь задач для сервера.
-- Доступ только у системной роли: приложению салонов (salon_app) эти таблицы недоступны.
CREATE TABLE "AdminUser" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "email"          TEXT NOT NULL UNIQUE,
  "passwordHash"   TEXT NOT NULL,
  -- Секрет одноразовых кодов (TOTP), зашифрован AES-256-GCM
  "totpSecretEnc"  TEXT NOT NULL,
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil"    TIMESTAMPTZ(3),
  "lastLoginAt"    TIMESTAMPTZ(3),
  "lastLoginIp"    TEXT,
  "createdAt"      TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

-- Задачи для сервера: панель ставит, скрипт deploy/scripts/admin-agent.sh на сервере выполняет
CREATE TABLE "AdminTask" (
  "id"          BIGSERIAL PRIMARY KEY,
  "kind"        TEXT NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'PENDING',
  "output"      TEXT,
  "requestedBy" TEXT NOT NULL,
  "createdAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "startedAt"   TIMESTAMPTZ(3),
  "finishedAt"  TIMESTAMPTZ(3)
);
CREATE INDEX "AdminTask_status_idx" ON "AdminTask"("status", "id");

REVOKE ALL ON "AdminUser", "AdminTask" FROM salon_app;
REVOKE ALL ON SEQUENCE "AdminTask_id_seq" FROM salon_app;
