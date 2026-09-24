-- Konsi (consignment) sell-through period report. A report closes a counting period for a
-- konsi store: opening/in/out/POS-sold/gap/closing/counted/billed quantities per item variant,
-- with a suggested vs. actual resolution (bill, write off as shrinkage, bill at POS price, or
-- reduce future consignment).
--
-- Two partial-unique keys enforce the report's lifecycle, mirroring StoreStocktake.openKey:
--   - stocktakeKey holds the closing stocktake id while the report is not cancelled, and is
--     nulled on cancel -- one live report per stocktake.
--   - chainKey holds `${storeId}:${previousId ?? "root"}` while not cancelled, and is nulled on
--     cancel -- one successor per report and one root per store, which also caps a store at one
--     DRAFT report at a time.
-- Both are application-maintained; no CHECK/trigger enforces the null-on-cancel rule.
--
-- The relation to StoreStocktake is deliberately NOT modelled (plain id + index only), so no
-- 1:1 delete-emulation guard applies to it.
--
-- Widens DocType with SELLTHRU on both DocNumberConfig and DocumentNumber -- both are MySQL ENUM
-- columns over the one Prisma enum, and skipping either dies with a data-truncation error the
-- first time a SELLTHRU number is generated. No FOREIGN KEY: relationMode = "prisma".
-- Additive, no backfill.
--
-- StoreStocktake gains countFinishedAt: when a save last changed the count's figures. Stocktake
-- approval re-applies every store ledger movement recorded after it on top of the counted figure,
-- so a sale or delivery while a count waits for approval is not erased. NULL on every stocktake
-- counted before this column existed, and approval falls back to setting the bare counted figure
-- for those.

ALTER TABLE `DocNumberConfig` MODIFY `docType` ENUM('PO','GRN','WO','ADJ','RET','ISSUE','RECEIPT','OPN','PUTUS','KONSI','VANLOAD','VANSALE','VANRECON','SPGSALE','DELIVERY','FIELDRET','KONSITRF','STOCKTAKE','PAYMENT','BKM','STORETRF','SELLTHRU') NOT NULL;
ALTER TABLE `DocumentNumber` MODIFY `docType` ENUM('PO','GRN','WO','ADJ','RET','ISSUE','RECEIPT','OPN','PUTUS','KONSI','VANLOAD','VANSALE','VANRECON','SPGSALE','DELIVERY','FIELDRET','KONSITRF','STOCKTAKE','PAYMENT','BKM','STORETRF','SELLTHRU') NOT NULL;

ALTER TABLE `Store` ADD COLUMN `sellThroughMethod` ENUM('SPG_POS', 'SHELF_COUNT') NULL;

ALTER TABLE `StoreStocktake` ADD COLUMN `countFinishedAt` DATETIME(3) NULL;

CREATE TABLE IF NOT EXISTS `KonsiSellThrough` (
  `id` VARCHAR(191) NOT NULL,
  `docNo` VARCHAR(191) NOT NULL,
  `storeId` VARCHAR(191) NOT NULL,
  `method` ENUM('SPG_POS', 'SHELF_COUNT') NOT NULL,
  `status` ENUM('DRAFT', 'APPROVED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `closingStocktakeId` VARCHAR(191) NOT NULL,
  `stocktakeKey` VARCHAR(191) NULL,
  `previousId` VARCHAR(191) NULL,
  `chainKey` VARCHAR(191) NULL,
  `periodStart` DATETIME(3) NULL,
  `periodEnd` DATETIME(3) NOT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `approvedById` VARCHAR(191) NULL,
  `approvedAt` DATETIME(3) NULL,
  `cancelledById` VARCHAR(191) NULL,
  `cancelledAt` DATETIME(3) NULL,
  `cancelReason` TEXT NULL,
  UNIQUE INDEX `KonsiSellThrough_docNo_key`(`docNo`),
  UNIQUE INDEX `KonsiSellThrough_stocktakeKey_key`(`stocktakeKey`),
  UNIQUE INDEX `KonsiSellThrough_chainKey_key`(`chainKey`),
  INDEX `KonsiSellThrough_storeId_createdAt_idx`(`storeId`, `createdAt`),
  INDEX `KonsiSellThrough_status_idx`(`status`),
  INDEX `KonsiSellThrough_closingStocktakeId_idx`(`closingStocktakeId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `KonsiSellThroughLine` (
  `id` VARCHAR(191) NOT NULL,
  `sellThroughId` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
  `productName` VARCHAR(191) NOT NULL,
  `openingQty` DECIMAL(10, 2) NOT NULL,
  `inQty` DECIMAL(10, 2) NOT NULL,
  `outQty` DECIMAL(10, 2) NOT NULL,
  `posSoldQty` DECIMAL(10, 2) NOT NULL,
  `gapQty` DECIMAL(10, 2) NOT NULL,
  `closingQty` DECIMAL(10, 2) NOT NULL,
  `countedQty` DECIMAL(10, 2) NULL,
  `billedQty` DECIMAL(10, 2) NOT NULL,
  `shrinkageQty` DECIMAL(10, 2) NOT NULL DEFAULT 0,
  `negativeSold` BOOLEAN NOT NULL DEFAULT false,
  `suggestedResolution` ENUM('BILL', 'SHRINKAGE', 'BILL_POS', 'REDUCE') NULL,
  `resolution` ENUM('BILL', 'SHRINKAGE', 'BILL_POS', 'REDUCE') NULL,
  `resolutionReason` TEXT NULL,
  `unitCost` DECIMAL(15, 2) NOT NULL,
  UNIQUE INDEX `KonsiSellThroughLine_sellThroughId_itemId_variantSku_key`(`sellThroughId`, `itemId`, `variantSku`),
  INDEX `KonsiSellThroughLine_sellThroughId_idx`(`sellThroughId`),
  INDEX `KonsiSellThroughLine_itemId_idx`(`itemId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
