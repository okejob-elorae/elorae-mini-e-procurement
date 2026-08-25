-- Store stocktake: a periodic count of a store's ledger, with a nullable-unique openKey
-- enforcing one open (DRAFT/PENDING_VERIFICATION) stocktake per store at the database level,
-- the same idiom as StoreChangeRequest.pendingKey.
--
-- Re-runnable: a migration recorded as failed blocks every later deploy until
-- `prisma migrate resolve --rolled-back 20260825160000_add_store_stocktake`, and idempotent
-- SQL is what makes re-running that recovery safe. No FOREIGN KEY: relationMode = "prisma".
-- Additive, no backfill.

-- AlterEnum (DocType += STOCKTAKE)
ALTER TABLE `DocNumberConfig` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE', 'VANRECON', 'SPGSALE', 'DELIVERY', 'FIELDRET', 'KONSITRF', 'STOCKTAKE') NOT NULL;
ALTER TABLE `DocumentNumber` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE', 'VANRECON', 'SPGSALE', 'DELIVERY', 'FIELDRET', 'KONSITRF', 'STOCKTAKE') NOT NULL;

CREATE TABLE IF NOT EXISTS `StoreStocktake` (
  `id` VARCHAR(191) NOT NULL,
  `docNo` VARCHAR(191) NOT NULL,
  `storeId` VARCHAR(191) NOT NULL,
  `status` ENUM('DRAFT', 'PENDING_VERIFICATION', 'APPROVED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `openKey` VARCHAR(191) NULL,
  `countedAt` DATETIME(3) NOT NULL,
  `periodFrom` DATETIME(3) NULL,
  `isFullCount` BOOLEAN NOT NULL DEFAULT false,
  `note` TEXT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `submittedById` VARCHAR(191) NULL,
  `submittedAt` DATETIME(3) NULL,
  `approvedById` VARCHAR(191) NULL,
  `approvedAt` DATETIME(3) NULL,
  `cancelledById` VARCHAR(191) NULL,
  `cancelledAt` DATETIME(3) NULL,
  `cancelReason` TEXT NULL,
  UNIQUE INDEX `StoreStocktake_docNo_key`(`docNo`),
  UNIQUE INDEX `StoreStocktake_openKey_key`(`openKey`),
  INDEX `StoreStocktake_storeId_createdAt_idx`(`storeId`, `createdAt`),
  INDEX `StoreStocktake_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `StoreStocktakeLine` (
  `id` VARCHAR(191) NOT NULL,
  `stocktakeId` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
  `productName` VARCHAR(191) NOT NULL,
  `expectedQty` DECIMAL(10, 2) NOT NULL,
  `countedQty` DECIMAL(10, 2) NULL,
  `varianceQty` DECIMAL(10, 2) NULL,
  `soldInPeriodQty` DECIMAL(10, 2) NOT NULL DEFAULT 0,
  `cause` ENUM('SHRINKAGE', 'UNRECORDED_SALE') NULL,
  `reason` TEXT NULL,
  `qtyAtApproval` DECIMAL(10, 2) NULL,
  `appliedQty` DECIMAL(10, 2) NULL,
  `isAdded` BOOLEAN NOT NULL DEFAULT false,
  UNIQUE INDEX `StoreStocktakeLine_stocktakeId_itemId_variantSku_key`(`stocktakeId`, `itemId`, `variantSku`),
  INDEX `StoreStocktakeLine_stocktakeId_idx`(`stocktakeId`),
  INDEX `StoreStocktakeLine_itemId_idx`(`itemId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
