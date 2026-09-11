-- Field retur value: what a store is credited for goods it sent back, priced from the
-- delivery line it was billed on, plus the per-resolution amount a salesman owes or the
-- company writes off.
--
-- Re-runnable: a migration recorded as failed blocks every later deploy until
-- `prisma migrate resolve --rolled-back 20260825120000_add_field_return_value`, and
-- idempotent SQL is what makes re-running that recovery safe. No FOREIGN KEY: relationMode = "prisma".

ALTER TABLE `FieldReturnLine` ADD COLUMN IF NOT EXISTS `creditedQty` INTEGER NULL;
ALTER TABLE `FieldReturnLine` ADD COLUMN IF NOT EXISTS `unitPrice` DECIMAL(15, 2) NULL;
ALTER TABLE `FieldReturnLine` ADD COLUMN IF NOT EXISTS `lineValue` DECIMAL(15, 2) NULL;
ALTER TABLE `FieldReturnLine` ADD COLUMN IF NOT EXISTS `priceSource` ENUM('DELIVERY', 'MANUAL') NULL;
ALTER TABLE `FieldReturnLine` ADD COLUMN IF NOT EXISTS `priceDeliveryLineId` VARCHAR(191) NULL;
ALTER TABLE `FieldReturnLine` ADD COLUMN IF NOT EXISTS `priceNote` TEXT NULL;

ALTER TABLE `FieldReturn` ADD COLUMN IF NOT EXISTS `totalValue` DECIMAL(15, 2) NULL;
ALTER TABLE `FieldReturn` ADD COLUMN IF NOT EXISTS `valuationStatus` ENUM('PENDING', 'VALUED') NOT NULL DEFAULT 'PENDING';

ALTER TABLE `FieldReturnResolution` ADD COLUMN IF NOT EXISTS `amount` DECIMAL(15, 2) NULL;
