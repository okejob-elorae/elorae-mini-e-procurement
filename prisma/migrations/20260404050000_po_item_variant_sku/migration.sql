-- AlterTable
ALTER TABLE `POItem` ADD COLUMN `variantSku` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `POItem_poId_itemId_variantSku_idx` ON `POItem`(`poId`, `itemId`, `variantSku`);
