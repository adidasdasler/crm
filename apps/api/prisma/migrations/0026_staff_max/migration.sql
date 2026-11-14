-- Уведомления сотрудникам и коды входа в MAX (как в Telegram)
ALTER TABLE "User" ADD COLUMN "maxUserId" TEXT;
ALTER TABLE "User" ADD COLUMN "maxLinkHash" TEXT;
ALTER TABLE "User" ADD COLUMN "maxLinkExpires" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "User_maxLinkHash_key" ON "User"("maxLinkHash");
