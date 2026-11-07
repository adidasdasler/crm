-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReminderChannel" ADD VALUE 'VK';
ALTER TYPE "ReminderChannel" ADD VALUE 'MAX';
ALTER TYPE "ReminderChannel" ADD VALUE 'EMAIL';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "referrer" TEXT;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "maxUserId" TEXT,
ADD COLUMN     "vkUserId" TEXT;

-- CreateIndex
CREATE INDEX "Customer_vkUserId_idx" ON "Customer"("vkUserId");

-- CreateIndex
CREATE INDEX "Customer_maxUserId_idx" ON "Customer"("maxUserId");

