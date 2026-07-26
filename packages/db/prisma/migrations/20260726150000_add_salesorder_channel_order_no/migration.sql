-- AlterTable
ALTER TABLE `SalesOrder` ADD COLUMN `channelOrderNo` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `SalesOrder_channelOrderNo_idx` ON `SalesOrder`(`channelOrderNo`);
