-- Konsi virtual warehouse: consignment stock physically leaves main at approve and is tracked
-- per store, plus the transfer document that records the movement.
--
-- Re-runnable: a migration recorded as failed blocks every later deploy until
-- `prisma migrate resolve --rolled-back 20260825140000_add_konsi_virtual_warehouse`, and
-- idempotent SQL is what makes re-running that recovery safe. No FOREIGN KEY: relationMode = "prisma".
-- Additive, no backfill — a pre-existing konsi order simply has no transfer, which is the truth.

-- AlterEnum (DocType += KONSITRF)
ALTER TABLE `DocNumberConfig` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE', 'VANRECON', 'SPGSALE', 'DELIVERY', 'FIELDRET', 'KONSITRF') NOT NULL;
ALTER TABLE `DocumentNumber` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE', 'VANRECON', 'SPGSALE', 'DELIVERY', 'FIELDRET', 'KONSITRF') NOT NULL;

CREATE TABLE IF NOT EXISTS `StoreStock` (
  `id` VARCHAR(191) NOT NULL,
  `storeId` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
  `qty` DECIMAL(10, 2) NOT NULL DEFAULT 0,
  `avgCost` DECIMAL(15, 2) NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `StoreStock_storeId_itemId_variantSku_key`(`storeId`, `itemId`, `variantSku`),
  INDEX `StoreStock_storeId_idx`(`storeId`),
  INDEX `StoreStock_itemId_idx`(`itemId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `KonsiTransfer` (
  `id` VARCHAR(191) NOT NULL,
  `docNo` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `storeId` VARCHAR(191) NOT NULL,
  `transferredById` VARCHAR(191) NOT NULL,
  `note` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `KonsiTransfer_docNo_key`(`docNo`),
  INDEX `KonsiTransfer_storeId_createdAt_idx`(`storeId`, `createdAt`),
  INDEX `KonsiTransfer_orderId_idx`(`orderId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `KonsiTransferLine` (
  `id` VARCHAR(191) NOT NULL,
  `transferId` VARCHAR(191) NOT NULL,
  `orderLineId` VARCHAR(191) NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
  `productName` VARCHAR(191) NOT NULL,
  `qty` DECIMAL(10, 2) NOT NULL,
  `unitCost` DECIMAL(15, 2) NOT NULL,
  INDEX `KonsiTransferLine_transferId_idx`(`transferId`),
  INDEX `KonsiTransferLine_itemId_idx`(`itemId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
