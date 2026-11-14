-- Журнал ошибок сервера (API и воркер) для админ-панели. Хранится 30 дней.
-- Персональных данных не пишем: путь без токенов, текст ошибки, id запроса.
CREATE TABLE "ErrorLog" (
  "id"        BIGSERIAL PRIMARY KEY,
  "at"        TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "source"    TEXT NOT NULL,
  "path"      TEXT,
  "message"   TEXT NOT NULL,
  "stack"     TEXT,
  "requestId" TEXT
);
CREATE INDEX "ErrorLog_at_idx" ON "ErrorLog"("at" DESC);
