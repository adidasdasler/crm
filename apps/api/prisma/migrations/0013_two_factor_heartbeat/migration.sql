-- Вход с кодом (второй фактор) для сотрудников салона: код на email или в Telegram
ALTER TABLE "User" ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "loginChallengeHash" TEXT;
ALTER TABLE "User" ADD COLUMN "loginCodeHash" TEXT;
ALTER TABLE "User" ADD COLUMN "loginCodeExpires" TIMESTAMPTZ(3);
ALTER TABLE "User" ADD COLUMN "loginCodeAttempts" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "User_loginChallengeHash_key" ON "User"("loginChallengeHash");

-- «Пульс» фоновых процессов: мониторинг видит, что воркер жив
CREATE TABLE "Heartbeat" (
  "name" TEXT PRIMARY KEY,
  "at"   TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "info" JSONB
);
