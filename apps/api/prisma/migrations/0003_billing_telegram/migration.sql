-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "billingPeriod" "BillingPeriod" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "confirmationUrl" TEXT,
ADD COLUMN     "planId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "Subscription" DROP COLUMN "paymentMethodId",
ADD COLUMN     "lastNoticeAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "telegramChatId" TEXT,
ADD COLUMN     "telegramLinkExpires" TIMESTAMPTZ(3),
ADD COLUMN     "telegramLinkHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramLinkHash_key" ON "User"("telegramLinkHash");


-- Поиск клиента по чату Telegram (кнопки «Подтвердить/Отменить» в боте)
CREATE INDEX "Customer_telegramChatId_idx" ON "Customer"("telegramChatId");
