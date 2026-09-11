-- Salesman-raised retur request. Status stops at PENDING_WAREHOUSE_RECEIVING; receiving,
-- mismatch resolution and stock restore belong to the Retur Management epic.
--
-- Re-runnable: a migration recorded as failed blocks every later deploy until
-- `prisma migrate resolve --rolled-back 20260814120000_add_field_return`, and idempotent SQL
-- is what makes re-running that recovery safe. No FOREIGN KEY: relationMode = "prisma".

CREATE TABLE IF NOT EXISTS `FieldReturn` (
  `id` VARCHAR(191) NOT NULL,
  `docNo` VARCHAR(191) NOT NULL,
  `storeId` VARCHAR(191) NOT NULL,
  `visitId` VARCHAR(191) NULL,
  `raisedById` VARCHAR(191) NOT NULL,
  `status` ENUM('PENDING_WAREHOUSE_RECEIVING', 'CANCELLED') NOT NULL DEFAULT 'PENDING_WAREHOUSE_RECEIVING',
  `transport` ENUM('SELF_CARRY', 'EXPEDITION') NOT NULL,
  `expeditionName` VARCHAR(191) NULL,
  `resiNo` VARCHAR(191) NULL,
  `notaPhotoUrl` VARCHAR(191) NOT NULL,
  `notaPhotoR2Key` VARCHAR(191) NOT NULL,
  `note` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `FieldReturn_docNo_key`(`docNo`),
  INDEX `FieldReturn_storeId_idx`(`storeId`),
  INDEX `FieldReturn_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `FieldReturnLine` (
  `id` VARCHAR(191) NOT NULL,
  `returnId` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
  `qty` INTEGER NOT NULL,
  `reason` ENUM('DAMAGED', 'UNSOLD', 'EXPIRED', 'OTHER') NOT NULL,
  `reasonNote` VARCHAR(191) NULL,
  INDEX `FieldReturnLine_returnId_idx`(`returnId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
