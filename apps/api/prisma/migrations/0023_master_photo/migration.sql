-- Фото мастера: видно клиентам при онлайн-записи. Файл в хранилище (том uploads), здесь — ключ.
ALTER TABLE "Resource" ADD COLUMN "photoKey" TEXT;
-- Тариф «Старт»: до 5 мастеров (было 3)
UPDATE "Plan" SET "limits" = jsonb_set("limits"::jsonb, '{masters}', '5') WHERE "code" = 'START';
