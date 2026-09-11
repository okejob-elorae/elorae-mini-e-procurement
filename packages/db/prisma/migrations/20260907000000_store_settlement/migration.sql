-- Store settlement document: the salesman-filled record of which invoices are being settled at
-- a store, what deductions (retur credit, event programs, an admin fee) come off them, and what
-- was actually paid vs expected. This slice moves no money and posts no journal -- it is schema
-- + doc-number plumbing only.
--
-- Widens DocType with BKM (the settlement's own doc-number register) on both DocNumberConfig and
-- DocumentNumber -- both are MySQL ENUM columns, and skipping either dies with a data-truncation
-- error the first time a BKM number is generated. No FOREIGN KEY: relationMode = "prisma".
-- Additive, no backfill.

ALTER TABLE `DocNumberConfig` MODIFY `docType` ENUM('PO','GRN','WO','ADJ','RET','ISSUE','RECEIPT','OPN','PUTUS','KONSI','VANLOAD','VANSALE','VANRECON','SPGSALE','DELIVERY','FIELDRET','KONSITRF','STOCKTAKE','PAYMENT','BKM') NOT NULL;
ALTER TABLE `DocumentNumber` MODIFY `docType` ENUM('PO','GRN','WO','ADJ','RET','ISSUE','RECEIPT','OPN','PUTUS','KONSI','VANLOAD','VANSALE','VANRECON','SPGSALE','DELIVERY','FIELDRET','KONSITRF','STOCKTAKE','PAYMENT','BKM') NOT NULL;

CREATE TABLE IF NOT EXISTS `StoreSettlement` (
  `id` VARCHAR(191) NOT NULL,
  `docNo` VARCHAR(191) NOT NULL,
  `storeId` VARCHAR(191) NOT NULL,
  `salesmanId` VARCHAR(191) NOT NULL,
  `expectedAmount` DECIMAL(15, 2) NOT NULL,
  `actualAmount` DECIMAL(15, 2) NOT NULL,
  `varianceAmount` DECIMAL(15, 2) NOT NULL,
  `isFlagged` BOOLEAN NOT NULL DEFAULT false,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `note` TEXT NULL,
  `rejectReason` TEXT NULL,
  `reviewedById` VARCHAR(191) NULL,
  `reviewedAt` DATETIME(3) NULL,
  `idempotencyKey` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `StoreSettlement_docNo_key`(`docNo`),
  UNIQUE INDEX `StoreSettlement_idempotencyKey_key`(`idempotencyKey`),
  INDEX `StoreSettlement_storeId_status_idx`(`storeId`, `status`),
  INDEX `StoreSettlement_salesmanId_status_idx`(`salesmanId`, `status`),
  INDEX `StoreSettlement_status_createdAt_idx`(`status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `StoreSettlementInvoice` (
  `id` VARCHAR(191) NOT NULL,
  `settlementId` VARCHAR(191) NOT NULL,
  `receivableId` VARCHAR(191) NOT NULL,
  `amount` DECIMAL(15, 2) NOT NULL,
  UNIQUE INDEX `StoreSettlementInvoice_settlementId_receivableId_key`(`settlementId`, `receivableId`),
  INDEX `StoreSettlementInvoice_receivableId_idx`(`receivableId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `StoreSettlementDeduction` (
  `id` VARCHAR(191) NOT NULL,
  `settlementId` VARCHAR(191) NOT NULL,
  `type` ENUM('RETUR_OFFSET', 'PROGRAM', 'ADMIN_FEE') NOT NULL,
  `amount` DECIMAL(15, 2) NOT NULL,
  `percent` DECIMAL(5, 2) NULL,
  `fieldReturnId` VARCHAR(191) NULL,
  `note` TEXT NULL,
  `proofUrl` VARCHAR(191) NULL,
  `proofR2Key` VARCHAR(191) NULL,
  INDEX `StoreSettlementDeduction_settlementId_idx`(`settlementId`),
  INDEX `StoreSettlementDeduction_fieldReturnId_type_idx`(`fieldReturnId`, `type`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
