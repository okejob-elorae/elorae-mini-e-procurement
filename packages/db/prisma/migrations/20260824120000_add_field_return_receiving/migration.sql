-- Warehouse receiving for field returns: the count, its sellable/rejected split, and the
-- append-only resolution records that settle a discrepancy.
--
-- Re-runnable: a migration recorded as failed blocks every later deploy until
-- `prisma migrate resolve --rolled-back 20260824120000_add_field_return_receiving`, and
-- idempotent SQL is what makes re-running that recovery safe. No FOREIGN KEY: relationMode = "prisma".

ALTER TABLE `FieldReturn`
  MODIFY COLUMN `status` ENUM('PENDING_WAREHOUSE_RECEIVING', 'MISMATCH_PENDING_RESOLUTION', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_WAREHOUSE_RECEIVING';

ALTER TABLE `FieldReturn` ADD COLUMN IF NOT EXISTS `receivedAt` DATETIME(3) NULL;
ALTER TABLE `FieldReturn` ADD COLUMN IF NOT EXISTS `receivedById` VARCHAR(191) NULL;
ALTER TABLE `FieldReturn` ADD COLUMN IF NOT EXISTS `approvedAt` DATETIME(3) NULL;
ALTER TABLE `FieldReturn` ADD COLUMN IF NOT EXISTS `approvedById` VARCHAR(191) NULL;

ALTER TABLE `FieldReturnLine` ADD COLUMN IF NOT EXISTS `receivedQty` INTEGER NULL;
ALTER TABLE `FieldReturnLine` ADD COLUMN IF NOT EXISTS `sellableQty` INTEGER NULL;
ALTER TABLE `FieldReturnLine` ADD COLUMN IF NOT EXISTS `rejectedQty` INTEGER NULL;

CREATE TABLE IF NOT EXISTS `FieldReturnResolution` (
  `id` VARCHAR(191) NOT NULL,
  `lineId` VARCHAR(191) NOT NULL,
  `type` ENUM('SALESMAN_BEARS', 'INVESTIGATE', 'WRITE_OFF', 'ACCEPT_SURPLUS') NOT NULL,
  `qty` INTEGER NOT NULL,
  `note` TEXT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `FieldReturnResolution_lineId_idx`(`lineId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
