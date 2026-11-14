-- Уведомления сотрудникам и коды входа во ВКонтакте (сообщения сообщества MioFlow)
ALTER TABLE "User" ADD COLUMN "vkUserId" TEXT;
ALTER TABLE "User" ADD COLUMN "vkLinkHash" TEXT;
ALTER TABLE "User" ADD COLUMN "vkLinkExpires" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "User_vkLinkHash_key" ON "User"("vkLinkHash");
