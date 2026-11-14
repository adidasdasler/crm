-- Действия поддержки из панели владельца: блокировка салона и восстановление после удаления
ALTER TABLE "Tenant" ADD COLUMN "blockedAt" TIMESTAMPTZ(3);
ALTER TABLE "Tenant" ADD COLUMN "blockReason" TEXT;
-- Адрес страницы до удаления: при восстановлении в течение 30 дней салон получает его обратно
ALTER TABLE "Tenant" ADD COLUMN "deletedSlug" TEXT;
