-- Вход сотрудников салонов (владельцев, мастеров) через Яндекс ID и VK ID
ALTER TABLE "User" ADD COLUMN "yandexId" TEXT;
ALTER TABLE "User" ADD COLUMN "vkId" TEXT;
CREATE UNIQUE INDEX "User_yandexId_key" ON "User"("yandexId");
CREATE UNIQUE INDEX "User_vkId_key" ON "User"("vkId");

-- Одноразовые билеты после входа через Яндекс/VK: «войти» (мобильное приложение) и «зарегистрироваться»
CREATE TABLE "OAuthTicket" (
  "hash"      TEXT PRIMARY KEY,
  "kind"      TEXT NOT NULL,
  "payload"   JSONB NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL
);
REVOKE ALL ON "OAuthTicket" FROM salon_app;
