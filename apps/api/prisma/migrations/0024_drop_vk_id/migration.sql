-- Вход через VK ID убран: остаются пароль/код и Яндекс ID
ALTER TABLE "User" DROP COLUMN IF EXISTS "vkId";
ALTER TABLE "ClientUser" DROP COLUMN IF EXISTS "vkId";
