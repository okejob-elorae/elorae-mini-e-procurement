-- AlterTable
ALTER TABLE `WorkOrder` ADD COLUMN `consumptionMaterialId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `WorkOrder_consumptionMaterialId_idx` ON `WorkOrder`(`consumptionMaterialId`);

-- AddForeignKey
ALTER TABLE `WorkOrder` ADD CONSTRAINT `WorkOrder_consumptionMaterialId_fkey` FOREIGN KEY (`consumptionMaterialId`) REFERENCES `Item`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
