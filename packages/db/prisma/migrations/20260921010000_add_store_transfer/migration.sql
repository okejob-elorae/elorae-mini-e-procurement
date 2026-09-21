-- Store-to-store transfer document. The system can already move stock main->store
-- (KonsiTransfer, implicitly main-origin, bound to a FieldSalesOrder) and store->main (a field
-- return), but not store->store. StoreTransfer is a new pair of models, not a widened
-- KonsiTransfer -- that model has no source-store concept at all and is bound to an order this
-- document has no reason to carry.
--
-- Schema + doc-number plumbing only. The writer (moveStoreStock out of fromStore, into toStore,
-- same cost basis) is a later task; this migration moves no stock and posts no journal.
--
-- Widens DocType with STORETRF on both DocNumberConfig and DocumentNumber -- both are MySQL ENUM
-- columns over the one Prisma enum, and skipping either dies with a data-truncation error the
-- first time a STORETRF number is generated. No FOREIGN KEY: relationMode = "prisma".
-- Additive, no backfill.

ALTER TABLE `DocNumberConfig` MODIFY `docType` ENUM('PO','GRN','WO','ADJ','RET','ISSUE','RECEIPT','OPN','PUTUS','KONSI','VANLOAD','VANSALE','VANRECON','SPGSALE','DELIVERY','FIELDRET','KONSITRF','STOCKTAKE','PAYMENT','BKM','STORETRF') NOT NULL;
ALTER TABLE `DocumentNumber` MODIFY `docType` ENUM('PO','GRN','WO','ADJ','RET','ISSUE','RECEIPT','OPN','PUTUS','KONSI','VANLOAD','VANSALE','VANRECON','SPGSALE','DELIVERY','FIELDRET','KONSITRF','STOCKTAKE','PAYMENT','BKM','STORETRF') NOT NULL;

CREATE TABLE IF NOT EXISTS `StoreTransfer` (
  `id` VARCHAR(191) NOT NULL,
  `docNo` VARCHAR(191) NOT NULL,
  `fromStoreId` VARCHAR(191) NOT NULL,
  `toStoreId` VARCHAR(191) NOT NULL,
  `status` ENUM('PENDING', 'APPROVED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  `note` TEXT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `approvedById` VARCHAR(191) NULL,
  `approvedAt` DATETIME(3) NULL,
  UNIQUE INDEX `StoreTransfer_docNo_key`(`docNo`),
  INDEX `StoreTransfer_fromStoreId_createdAt_idx`(`fromStoreId`, `createdAt`),
  INDEX `StoreTransfer_toStoreId_createdAt_idx`(`toStoreId`, `createdAt`),
  INDEX `StoreTransfer_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `StoreTransferLine` (
  `id` VARCHAR(191) NOT NULL,
  `transferId` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
  `productName` VARCHAR(191) NOT NULL,
  `qty` DECIMAL(10, 2) NOT NULL,
  `unitCost` DECIMAL(15, 2) NOT NULL,
  INDEX `StoreTransferLine_transferId_idx`(`transferId`),
  INDEX `StoreTransferLine_itemId_idx`(`itemId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
