-- Возврат клиентов: когда последний раз писали «давно не были» и поздравляли с днём рождения
ALTER TABLE "Customer" ADD COLUMN "lastWinbackAt" TIMESTAMPTZ(3);
ALTER TABLE "Customer" ADD COLUMN "lastBirthdayAt" TIMESTAMPTZ(3);
