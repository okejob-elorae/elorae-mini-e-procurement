-- AlterTable
ALTER TABLE `WorkOrder` ADD COLUMN `poId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `WorkOrder_poId_idx` ON `WorkOrder`(`poId`);

-- AddForeignKey
ALTER TABLE `WorkOrder` ADD CONSTRAINT `WorkOrder_poId_fkey` FOREIGN KEY (`poId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
