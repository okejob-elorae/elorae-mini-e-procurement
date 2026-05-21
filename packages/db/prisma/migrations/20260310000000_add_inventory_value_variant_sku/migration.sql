-- AlterTable
ALTER TABLE `InventoryValue` ADD COLUMN `variantSku` VARCHAR(191) NULL;

-- Backfill existing rows: variantSku remains NULL (default for new column)
-- Drop unique on itemId and add composite unique on (itemId, variantSku)
ALTER TABLE `InventoryValue` DROP INDEX `InventoryValue_itemId_key`;

ALTER TABLE `InventoryValue` ADD UNIQUE INDEX `InventoryValue_itemId_variantSku_key`(`itemId`, `variantSku`);
