-- Согласие на показ фото мастера клиентам (ст. 10.1 152-ФЗ, ст. 152.1 ГК РФ):
-- self — мастер сам загрузил своё фото и подтвердил согласие; written — салон подтвердил, что у него есть письменное согласие мастера
ALTER TABLE "Resource" ADD COLUMN "photoConsent" TEXT;
ALTER TABLE "Resource" ADD COLUMN "photoConsentAt" TIMESTAMPTZ(3);
ALTER TABLE "Resource" ADD COLUMN "photoConsentBy" UUID;
