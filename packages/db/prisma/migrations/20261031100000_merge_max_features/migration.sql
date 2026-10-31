-- Brings Max's features (branch timotiusmax-arsip, 677065bc) onto the team's master.
-- Generated with `prisma migrate diff` from the team's schema at 82205090 to the merged
-- schema, then hand-edited where a new NOT NULL column lands on a table that may already
-- hold rows: Receivable.invoiceNo, StoreTransfer.idempotencyKey, StoreTransfer.updatedAt
-- are added NULL, backfilled, then tightened. Max's own 40 MariaDB migrations (never run on
-- any MariaDB) are replaced by this file; their data statements only touched tables this
-- migration creates empty, so nothing is lost on a database that never had them.

-- StoreTransferLine.qty becomes INTEGER. Refuse to run if any existing line holds a
-- fractional quantity rather than silently rounding it (ERROR 1242 aborts the migration).
SELECT IF(
  (SELECT COUNT(*) FROM `StoreTransferLine` WHERE `qty` <> FLOOR(`qty`)) = 0,
  'preflight ok',
  (SELECT 'ABORT: fractional StoreTransferLine.qty' UNION ALL SELECT 'ABORT')
);

-- AlterTable
ALTER TABLE `User` ADD COLUMN `chartColors` TEXT NULL,
    ADD COLUMN `themeFontId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `SupplierType` ADD COLUMN `color` VARCHAR(191) NULL,
    ADD COLUMN `colorTcx` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Supplier` ADD COLUMN `hasNpwp` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `isPkp` BOOLEAN NULL,
    ADD COLUMN `npwpEnc` TEXT NULL,
    ADD COLUMN `npwpLast4` VARCHAR(191) NULL,
    ADD COLUMN `skbNumber` VARCHAR(191) NULL,
    ADD COLUMN `skbPhotoUrl` VARCHAR(191) NULL,
    ADD COLUMN `skbValidUntil` DATETIME(3) NULL,
    ADD COLUMN `taxWithholding` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Store` ADD COLUMN `consignmentVat` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `groupId` VARCHAR(191) NULL,
    ADD COLUMN `isPkp` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `maxOpenInvoices` INTEGER NULL,
    ADD COLUMN `nitku` VARCHAR(191) NULL,
    ADD COLUMN `salesmanId` VARCHAR(191) NULL,
    ADD COLUMN `storeClass` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `StoreVisit` ADD COLUMN `capturedOffline` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `checkinAccuracyMeters` INTEGER NULL,
    ADD COLUMN `checkinFlags` JSON NULL,
    ADD COLUMN `clientId` VARCHAR(191) NULL,
    ADD COLUMN `outcome` VARCHAR(191) NULL,
    ADD COLUMN `outcomeNote` TEXT NULL,
    ADD COLUMN `syncedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `VisitPhoto` ADD COLUMN `displayGuideId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `FieldSalesOrder` ADD COLUMN `cancelledAt` DATETIME(3) NULL,
    ADD COLUMN `cancelledById` VARCHAR(191) NULL,
    ADD COLUMN `kreditCatatan` TEXT NULL,
    ADD COLUMN `kreditDitahan` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `preorderWindowId` VARCHAR(191) NULL,
    ADD COLUMN `remoteChannel` VARCHAR(191) NULL,
    ADD COLUMN `replacesOrderId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `FieldSalesOrderLine` ADD COLUMN `bonusPromoId` VARCHAR(191) NULL,
    ADD COLUMN `isBonus` BOOLEAN NOT NULL DEFAULT false,
    MODIFY `appealReason` TEXT NULL;

-- AlterTable
ALTER TABLE `FieldSalesDelivery` ADD COLUMN `podPhotoUrl` VARCHAR(191) NULL,
    ADD COLUMN `receivedAt` DATETIME(3) NULL,
    ADD COLUMN `receivedByName` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Receivable` ADD COLUMN `amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `invoiceNo` VARCHAR(191) NULL,
    ADD COLUMN `note` TEXT NULL,
    ADD COLUMN `outstanding` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `paidBeforeImport` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `salesmanId` VARCHAR(191) NULL,
    ADD COLUMN `settledAt` DATETIME(3) NULL,
    ADD COLUMN `source` ENUM('DELIVERY', 'IMPORT', 'MANUAL') NOT NULL DEFAULT 'DELIVERY',
    MODIFY `originalAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    MODIFY `outstandingAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0;

UPDATE `Receivable` r
LEFT JOIN `FieldSalesDelivery` d ON d.`id` = r.`deliveryId`
LEFT JOIN `KonsiSellThrough` k ON k.`id` = r.`sellThroughId`
SET r.`invoiceNo` = COALESCE(d.`docNo`, k.`docNo`, r.`id`),
    r.`amount` = r.`originalAmount`,
    r.`outstanding` = r.`outstandingAmount`
WHERE r.`invoiceNo` IS NULL;

ALTER TABLE `Receivable` MODIFY `invoiceNo` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `StoreTransfer` ADD COLUMN `cancelledAt` DATETIME(3) NULL,
    ADD COLUMN `cancelledById` VARCHAR(191) NULL,
    ADD COLUMN `idempotencyKey` VARCHAR(191) NULL,
    ADD COLUMN `reason` VARCHAR(1000) NOT NULL DEFAULT '',
    ADD COLUMN `reviewNote` TEXT NULL,
    ADD COLUMN `selisihNote` TEXT NULL,
    ADD COLUMN `selisihStatus` ENUM('TERBUKA', 'HILANG', 'KEMBALI') NULL,
    ADD COLUMN `shippedAt` DATETIME(3) NULL,
    ADD COLUMN `shippedById` VARCHAR(191) NULL,
    ADD COLUMN `updatedAt` DATETIME(3) NULL,
    MODIFY `status` ENUM('PENDING', 'APPROVED', 'CANCELLED', 'DIAJUKAN', 'DISETUJUI', 'DIKIRIM', 'DITERIMA', 'DITOLAK', 'DIBATALKAN', 'DIKEMBALIKAN') NOT NULL DEFAULT 'PENDING',
    MODIFY `movedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

UPDATE `StoreTransfer` SET `idempotencyKey` = CONCAT('strf:', `id`) WHERE `idempotencyKey` IS NULL;

UPDATE `StoreTransfer` SET `updatedAt` = COALESCE(`approvedAt`, `createdAt`) WHERE `updatedAt` IS NULL;

ALTER TABLE `StoreTransfer` MODIFY `idempotencyKey` VARCHAR(191) NOT NULL,
    MODIFY `updatedAt` DATETIME(3) NOT NULL;

-- AlterTable
ALTER TABLE `StoreTransferLine` MODIFY `qty` INTEGER NOT NULL,
    MODIFY `unitCost` DECIMAL(15, 2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `Promo` ADD COLUMN `bonusBuyQty` INTEGER NULL,
    ADD COLUMN `bonusFreeQty` INTEGER NULL,
    ADD COLUMN `bonusItemId` VARCHAR(191) NULL,
    MODIFY `type` ENUM('PERCENT', 'FIXED', 'TIERED', 'BONUS') NOT NULL;

-- AlterTable
ALTER TABLE `Item` ADD COLUMN `careInstructions` TEXT NULL,
    ADD COLUMN `commissionPerPcs` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `kgPerRoll` DECIMAL(10, 2) NULL,
    ADD COLUMN `material` VARCHAR(191) NULL,
    ADD COLUMN `sizeChartId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `PurchaseOrder` ADD COLUMN `closeReason` TEXT NULL,
    ADD COLUMN `closedAt` DATETIME(3) NULL,
    ADD COLUMN `closedById` VARCHAR(191) NULL,
    ADD COLUMN `planStageId` VARCHAR(191) NULL,
    ADD COLUMN `ppnRatePercent` DECIMAL(5, 2) NULL;

-- AlterTable
ALTER TABLE `GRN` ADD COLUMN `idempotencyKey` VARCHAR(191) NULL,
    ADD COLUMN `ppnAmount` DECIMAL(15, 2) NULL;

-- AlterTable
ALTER TABLE `MaterialIssue` ADD COLUMN `idempotencyKey` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `FGReceipt` ADD COLUMN `additionalCost` DECIMAL(15, 2) NULL,
    ADD COLUMN `serviceCost` DECIMAL(15, 2) NULL;

-- AlterTable
ALTER TABLE `VendorReturn` ADD COLUMN `poCreditAmount` DECIMAL(15, 2) NULL,
    ADD COLUMN `poId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `PlanStage` ADD COLUMN `deadline` DATETIME(3) NULL,
    ADD COLUMN `scheduleStart` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `AuditLog` MODIFY `reason` TEXT NULL;

-- AlterTable
ALTER TABLE `DocNumberConfig` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE', 'VANRECON', 'SPGSALE', 'DELIVERY', 'FIELDRET', 'KONSITRF', 'STOCKTAKE', 'PAYMENT', 'BKM', 'STORETRF', 'SELLTHRU', 'ITEMREQ', 'VENDOR_BILL', 'VENDOR_PAYMENT', 'CASHOUT', 'CASHIN', 'CASHTRF', 'SUPPAY', 'ASSET') NOT NULL;

-- AlterTable
ALTER TABLE `DocumentNumber` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE', 'VANRECON', 'SPGSALE', 'DELIVERY', 'FIELDRET', 'KONSITRF', 'STOCKTAKE', 'PAYMENT', 'BKM', 'STORETRF', 'SELLTHRU', 'ITEMREQ', 'VENDOR_BILL', 'VENDOR_PAYMENT', 'CASHOUT', 'CASHIN', 'CASHTRF', 'SUPPAY', 'ASSET') NOT NULL;

-- AlterTable
ALTER TABLE `SpgSale` ADD COLUMN `capturedOffline` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `customerId` VARCHAR(191) NULL,
    ADD COLUMN `discountTotal` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `manualDiscount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `manualDiscountReason` TEXT NULL,
    ADD COLUMN `memberDiscount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `memberId` VARCHAR(191) NULL,
    ADD COLUMN `memberTier` VARCHAR(191) NULL,
    ADD COLUMN `orderDiscount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `orderPromoId` VARCHAR(191) NULL,
    ADD COLUMN `orderPromoName` VARCHAR(191) NULL,
    ADD COLUMN `syncedAt` DATETIME(3) NULL,
    ADD COLUMN `visitId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `SpgSaleLine` ADD COLUMN `counterPromoId` VARCHAR(191) NULL,
    ADD COLUMN `discount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `promoName` VARCHAR(191) NULL,
    ADD COLUMN `returnedQty` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `storeDiscount` DECIMAL(15, 2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `Journal` ADD COLUMN `approvedAt` DATETIME(3) NULL,
    ADD COLUMN `approvedById` VARCHAR(191) NULL,
    ADD COLUMN `originalDate` DATETIME(3) NULL,
    ADD COLUMN `rejectReason` TEXT NULL,
    ADD COLUMN `rejectedAt` DATETIME(3) NULL,
    ADD COLUMN `rejectedById` VARCHAR(191) NULL,
    ADD COLUMN `reversalOfId` VARCHAR(191) NULL,
    ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'POSTED';

-- AlterTable
ALTER TABLE `JournalLine` ADD COLUMN `channel` VARCHAR(191) NULL,
    ADD COLUMN `storeId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `StoreGroup` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StoreGroup_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlanStageStep` (
    `id` VARCHAR(191) NOT NULL,
    `planStageId` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `processTemplateId` VARCHAR(191) NULL,
    `supplierId` VARCHAR(191) NULL,
    `durationDays` INTEGER NOT NULL,
    `targetDate` DATETIME(3) NOT NULL,
    `doneDate` DATETIME(3) NULL,
    `status` ENUM('BELUM', 'PROSES', 'SELESAI') NOT NULL DEFAULT 'BELUM',
    `note` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PlanStageStep_planStageId_idx`(`planStageId`),
    INDEX `PlanStageStep_status_targetDate_idx`(`status`, `targetDate`),
    INDEX `PlanStageStep_supplierId_idx`(`supplierId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SpgSaleReturn` (
    `id` VARCHAR(191) NOT NULL,
    `spgSaleId` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `reason` TEXT NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SpgSaleReturn_idempotencyKey_key`(`idempotencyKey`),
    INDEX `SpgSaleReturn_spgSaleId_idx`(`spgSaleId`),
    INDEX `SpgSaleReturn_storeId_createdAt_idx`(`storeId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SpgSaleReturnLine` (
    `id` VARCHAR(191) NOT NULL,
    `returnId` VARCHAR(191) NOT NULL,
    `spgSaleLineId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
    `qty` INTEGER NOT NULL,
    `condition` ENUM('LAYAK', 'RUSAK', 'EXPIRED') NOT NULL DEFAULT 'LAYAK',

    INDEX `SpgSaleReturnLine_returnId_idx`(`returnId`),
    INDEX `SpgSaleReturnLine_spgSaleLineId_idx`(`spgSaleLineId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AccountingPeriod` (
    `id` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `closedAt` DATETIME(3) NULL,
    `closedById` VARCHAR(191) NULL,
    `closeNote` TEXT NULL,
    `reopenedAt` DATETIME(3) NULL,
    `reopenedById` VARCHAR(191) NULL,
    `reopenReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AccountingPeriod_status_idx`(`status`),
    UNIQUE INDEX `AccountingPeriod_year_month_key`(`year`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AccountingYear` (
    `id` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `closedAt` DATETIME(3) NULL,
    `closedById` VARCHAR(191) NULL,
    `closingJournalId` VARCHAR(191) NULL,
    `reopenedAt` DATETIME(3) NULL,
    `reopenedById` VARCHAR(191) NULL,
    `reopenReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AccountingYear_year_key`(`year`),
    INDEX `AccountingYear_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FixedAsset` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `acquisitionDate` DATETIME(3) NOT NULL,
    `cost` DECIMAL(18, 2) NOT NULL,
    `residualValue` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `usefulLifeMonths` INTEGER NOT NULL,
    `method` VARCHAR(191) NOT NULL DEFAULT 'STRAIGHT_LINE',
    `decliningRatePercent` DECIMAL(5, 2) NULL,
    `depreciationStartDate` DATETIME(3) NOT NULL,
    `accumulatedAtStart` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `assetAccountId` VARCHAR(191) NULL,
    `accumDepreciationAccountId` VARCHAR(191) NULL,
    `depreciationExpenseAccountId` VARCHAR(191) NULL,
    `supplierId` VARCHAR(191) NULL,
    `location` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `disposedAt` DATETIME(3) NULL,
    `disposalProceeds` DECIMAL(18, 2) NULL,
    `disposalNote` TEXT NULL,
    `disposedById` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FixedAsset_code_key`(`code`),
    INDEX `FixedAsset_status_idx`(`status`),
    INDEX `FixedAsset_category_idx`(`category`),
    INDEX `FixedAsset_acquisitionDate_idx`(`acquisitionDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FixedAssetDepreciation` (
    `id` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `period` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `journalId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FixedAssetDepreciation_period_idx`(`period`),
    UNIQUE INDEX `FixedAssetDepreciation_assetId_period_key`(`assetId`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecurringJournal` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `frequency` VARCHAR(191) NOT NULL DEFAULT 'MONTHLY',
    `dayOfMonth` INTEGER NOT NULL DEFAULT 1,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NULL,
    `autoReverse` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `lastRunPeriod` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RecurringJournal_active_idx`(`active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecurringJournalLine` (
    `id` VARCHAR(191) NOT NULL,
    `recurringJournalId` VARCHAR(191) NOT NULL,
    `chartAccountId` VARCHAR(191) NOT NULL,
    `debit` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `credit` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `memo` VARCHAR(191) NULL,
    `channel` VARCHAR(191) NULL,
    `storeId` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `RecurringJournalLine_recurringJournalId_idx`(`recurringJournalId`),
    INDEX `RecurringJournalLine_chartAccountId_idx`(`chartAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CashCategory` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'OUT',
    `chartAccountId` VARCHAR(191) NOT NULL,
    `withholdingType` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CashCategory_name_key`(`name`),
    INDEX `CashCategory_type_isActive_idx`(`type`, `isActive`),
    INDEX `CashCategory_chartAccountId_idx`(`chartAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CashVoucher` (
    `id` VARCHAR(191) NOT NULL,
    `docNumber` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `cashAccountId` VARCHAR(191) NOT NULL,
    `transferAccountId` VARCHAR(191) NULL,
    `counterpart` VARCHAR(191) NULL,
    `supplierId` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `totalAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `withholdingType` VARCHAR(191) NULL,
    `withholdingAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `netAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'POSTED',
    `cancelledAt` DATETIME(3) NULL,
    `cancelledById` VARCHAR(191) NULL,
    `cancelReason` TEXT NULL,
    `photoUrl` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CashVoucher_docNumber_key`(`docNumber`),
    UNIQUE INDEX `CashVoucher_idempotencyKey_key`(`idempotencyKey`),
    INDEX `CashVoucher_type_date_idx`(`type`, `date`),
    INDEX `CashVoucher_cashAccountId_date_idx`(`cashAccountId`, `date`),
    INDEX `CashVoucher_status_idx`(`status`),
    INDEX `CashVoucher_supplierId_idx`(`supplierId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CashVoucherLine` (
    `id` VARCHAR(191) NOT NULL,
    `voucherId` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NULL,
    `chartAccountId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `memo` VARCHAR(191) NULL,
    `channel` VARCHAR(191) NULL,
    `storeId` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `CashVoucherLine_voucherId_idx`(`voucherId`),
    INDEX `CashVoucherLine_chartAccountId_idx`(`chartAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BankStatementImport` (
    `id` VARCHAR(191) NOT NULL,
    `chartAccountId` VARCHAR(191) NOT NULL,
    `bankFormat` VARCHAR(191) NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `periodFrom` DATETIME(3) NULL,
    `periodTo` DATETIME(3) NULL,
    `openingBalance` DECIMAL(18, 2) NULL,
    `closingBalance` DECIMAL(18, 2) NULL,
    `lineCount` INTEGER NOT NULL DEFAULT 0,
    `importedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BankStatementImport_chartAccountId_periodFrom_idx`(`chartAccountId`, `periodFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BankStatementLine` (
    `id` VARCHAR(191) NOT NULL,
    `importId` VARCHAR(191) NOT NULL,
    `chartAccountId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `description` TEXT NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `balance` DECIMAL(18, 2) NULL,
    `externalRef` VARCHAR(191) NULL,
    `fingerprint` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'UNMATCHED',
    `matchedJournalLineId` VARCHAR(191) NULL,
    `matchedAt` DATETIME(3) NULL,
    `matchedById` VARCHAR(191) NULL,
    `createdJournalId` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BankStatementLine_matchedJournalLineId_key`(`matchedJournalLineId`),
    INDEX `BankStatementLine_importId_idx`(`importId`),
    INDEX `BankStatementLine_chartAccountId_date_idx`(`chartAccountId`, `date`),
    INDEX `BankStatementLine_status_idx`(`status`),
    UNIQUE INDEX `BankStatementLine_chartAccountId_fingerprint_key`(`chartAccountId`, `fingerprint`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SupplierPayment` (
    `id` VARCHAR(191) NOT NULL,
    `docNumber` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `method` VARCHAR(191) NOT NULL DEFAULT 'TRANSFER',
    `cashAccountId` VARCHAR(191) NULL,
    `reference` VARCHAR(191) NULL,
    `giroDueDate` DATETIME(3) NULL,
    `grossAmount` DECIMAL(18, 2) NOT NULL,
    `withholdingType` VARCHAR(191) NULL,
    `withholdingAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `netAmount` DECIMAL(18, 2) NOT NULL,
    `isAdvance` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(191) NOT NULL DEFAULT 'POSTED',
    `cancelledAt` DATETIME(3) NULL,
    `cancelledById` VARCHAR(191) NULL,
    `cancelReason` TEXT NULL,
    `note` TEXT NULL,
    `proofPhotoUrl` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SupplierPayment_docNumber_key`(`docNumber`),
    UNIQUE INDEX `SupplierPayment_idempotencyKey_key`(`idempotencyKey`),
    INDEX `SupplierPayment_supplierId_date_idx`(`supplierId`, `date`),
    INDEX `SupplierPayment_status_idx`(`status`),
    INDEX `SupplierPayment_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SupplierPaymentAllocation` (
    `id` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `targetType` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SupplierPaymentAllocation_paymentId_idx`(`paymentId`),
    INDEX `SupplierPaymentAllocation_targetType_targetId_idx`(`targetType`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Budget` (
    `id` VARCHAR(191) NOT NULL,
    `chartAccountId` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `note` VARCHAR(191) NULL,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Budget_year_month_idx`(`year`, `month`),
    UNIQUE INDEX `Budget_chartAccountId_year_month_key`(`chartAccountId`, `year`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaxPayment` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `period` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `paidAt` DATETIME(3) NOT NULL,
    `ntpn` VARCHAR(191) NULL,
    `billingCode` VARCHAR(191) NULL,
    `cashAccountId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'POSTED',
    `cancelledAt` DATETIME(3) NULL,
    `cancelledById` VARCHAR(191) NULL,
    `cancelReason` TEXT NULL,
    `note` TEXT NULL,
    `proofPhotoUrl` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TaxPayment_idempotencyKey_key`(`idempotencyKey`),
    INDEX `TaxPayment_type_period_idx`(`type`, `period`),
    INDEX `TaxPayment_paidAt_idx`(`paidAt`),
    INDEX `TaxPayment_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaxPeriodRecap` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `period` VARCHAR(191) NOT NULL,
    `outputDpp` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `outputTax` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `inputDpp` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `inputTax` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `compensation` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `balance` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `finalizedAt` DATETIME(3) NULL,
    `finalizedById` VARCHAR(191) NULL,
    `journalId` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TaxPeriodRecap_status_idx`(`status`),
    UNIQUE INDEX `TaxPeriodRecap_type_period_key`(`type`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OpeningBalanceImport` (
    `id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `cutoverDate` DATETIME(3) NOT NULL,
    `fileName` VARCHAR(191) NULL,
    `entries` JSON NOT NULL,
    `totalAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `journalId` VARCHAR(191) NULL,
    `postedAt` DATETIME(3) NULL,
    `postedById` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `OpeningBalanceImport_kind_status_idx`(`kind`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CollectionNote` (
    `id` VARCHAR(191) NOT NULL,
    `docNo` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `salesmanId` VARCHAR(191) NOT NULL,
    `handoverDate` DATETIME(3) NOT NULL,
    `promisedDate` DATETIME(3) NOT NULL,
    `receivedBy` VARCHAR(191) NULL,
    `amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `photoUrl` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `status` ENUM('BERJALAN', 'SELESAI', 'BATAL') NOT NULL DEFAULT 'BERJALAN',
    `source` VARCHAR(191) NOT NULL DEFAULT 'OFFICE',
    `confirmedAt` DATETIME(3) NULL,
    `confirmedById` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CollectionNote_docNo_key`(`docNo`),
    UNIQUE INDEX `CollectionNote_idempotencyKey_key`(`idempotencyKey`),
    INDEX `CollectionNote_storeId_status_idx`(`storeId`, `status`),
    INDEX `CollectionNote_promisedDate_idx`(`promisedDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CollectionNoteReceivable` (
    `collectionNoteId` VARCHAR(191) NOT NULL,
    `receivableId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,

    INDEX `CollectionNoteReceivable_receivableId_idx`(`receivableId`),
    PRIMARY KEY (`collectionNoteId`, `receivableId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentClaim` (
    `id` VARCHAR(191) NOT NULL,
    `docNo` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `salesmanId` VARCHAR(191) NOT NULL,
    `collectionNoteId` VARCHAR(191) NULL,
    `claimedTransferAt` DATETIME(3) NOT NULL,
    `method` VARCHAR(191) NOT NULL DEFAULT 'transfer',
    `invoiceAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `deductionTotal` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `receivedAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `transferPhotoUrl` VARCHAR(191) NULL,
    `breakdownPhotoUrl` VARCHAR(191) NULL,
    `giroNo` VARCHAR(191) NULL,
    `giroBank` VARCHAR(191) NULL,
    `giroIssueDate` DATETIME(3) NULL,
    `giroEffectiveDate` DATETIME(3) NULL,
    `giroStatus` VARCHAR(191) NULL,
    `giroSettledAt` DATETIME(3) NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `replacesClaimId` VARCHAR(191) NULL,
    `status` ENUM('DIKIRIM', 'TERVERIFIKASI', 'DITOLAK', 'DIBATALKAN') NOT NULL DEFAULT 'DIKIRIM',
    `verifiedById` VARCHAR(191) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `verifyNote` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PaymentClaim_docNo_key`(`docNo`),
    UNIQUE INDEX `PaymentClaim_idempotencyKey_key`(`idempotencyKey`),
    UNIQUE INDEX `PaymentClaim_replacesClaimId_key`(`replacesClaimId`),
    INDEX `PaymentClaim_storeId_status_idx`(`storeId`, `status`),
    INDEX `PaymentClaim_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `PaymentClaim_giroStatus_giroEffectiveDate_idx`(`giroStatus`, `giroEffectiveDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentClaimReceivable` (
    `paymentClaimId` VARCHAR(191) NOT NULL,
    `receivableId` VARCHAR(191) NOT NULL,
    `settledAmount` DECIMAL(15, 2) NOT NULL,

    INDEX `PaymentClaimReceivable_receivableId_idx`(`receivableId`),
    PRIMARY KEY (`paymentClaimId`, `receivableId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReceivableItem` (
    `id` VARCHAR(191) NOT NULL,
    `receivableId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `itemName` VARCHAR(191) NOT NULL,
    `qty` INTEGER NOT NULL,
    `price` DECIMAL(15, 2) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,

    INDEX `ReceivableItem_receivableId_idx`(`receivableId`),
    INDEX `ReceivableItem_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConsignmentCycle` (
    `id` VARCHAR(191) NOT NULL,
    `noKonsi` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `periodYear` INTEGER NOT NULL,
    `periodMonth` INTEGER NOT NULL,
    `spgDueDate` DATETIME(3) NULL,
    `noNota` VARCHAR(191) NULL,
    `notaAt` DATETIME(3) NULL,
    `noFakturPajak` VARCHAR(191) NULL,
    `fakturPajakAt` DATETIME(3) NULL,
    `lockedAt` DATETIME(3) NULL,
    `lockedById` VARCHAR(191) NULL,
    `promoBorneByElorae` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `lossChargedToStore` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `vatApplied` BOOLEAN NULL,
    `note` MEDIUMTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ConsignmentCycle_noKonsi_key`(`noKonsi`),
    INDEX `ConsignmentCycle_storeId_idx`(`storeId`),
    INDEX `ConsignmentCycle_periodYear_periodMonth_idx`(`periodYear`, `periodMonth`),
    UNIQUE INDEX `ConsignmentCycle_storeId_periodYear_periodMonth_key`(`storeId`, `periodYear`, `periodMonth`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConsignmentShipment` (
    `id` VARCHAR(191) NOT NULL,
    `noKirim` VARCHAR(191) NOT NULL,
    `cycleId` VARCHAR(191) NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `shippedAt` DATETIME(3) NOT NULL,
    `note` MEDIUMTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ConsignmentShipment_noKirim_key`(`noKirim`),
    INDEX `ConsignmentShipment_cycleId_idx`(`cycleId`),
    INDEX `ConsignmentShipment_storeId_idx`(`storeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConsignmentShipmentItem` (
    `id` VARCHAR(191) NOT NULL,
    `shipmentId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `variantSku` VARCHAR(191) NULL,
    `itemName` VARCHAR(191) NOT NULL,
    `qty` INTEGER NOT NULL,
    `price` DECIMAL(15, 2) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,

    INDEX `ConsignmentShipmentItem_shipmentId_idx`(`shipmentId`),
    INDEX `ConsignmentShipmentItem_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConsignmentReport` (
    `id` VARCHAR(191) NOT NULL,
    `cycleId` VARCHAR(191) NOT NULL,
    `source` ENUM('SPG', 'TOKO') NOT NULL,
    `reportedAt` DATETIME(3) NOT NULL,
    `reportedById` VARCHAR(191) NULL,
    `note` MEDIUMTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ConsignmentReport_cycleId_idx`(`cycleId`),
    UNIQUE INDEX `ConsignmentReport_cycleId_source_key`(`cycleId`, `source`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConsignmentReportItem` (
    `id` VARCHAR(191) NOT NULL,
    `reportId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `itemName` VARCHAR(191) NOT NULL,
    `qty` INTEGER NOT NULL,

    INDEX `ConsignmentReportItem_reportId_idx`(`reportId`),
    INDEX `ConsignmentReportItem_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConsignmentSold` (
    `id` VARCHAR(191) NOT NULL,
    `cycleId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `itemName` VARCHAR(191) NOT NULL,
    `qty` INTEGER NOT NULL,
    `price` DECIMAL(15, 2) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `commissionPerPcs` DECIMAL(15, 2) NOT NULL DEFAULT 0,

    INDEX `ConsignmentSold_cycleId_idx`(`cycleId`),
    INDEX `ConsignmentSold_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConsignmentPayment` (
    `id` VARCHAR(191) NOT NULL,
    `cycleId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `paidOn` DATETIME(3) NOT NULL,
    `method` VARCHAR(191) NOT NULL DEFAULT 'transfer',
    `note` TEXT NULL,
    `recordedById` VARCHAR(191) NOT NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelledById` VARCHAR(191) NULL,
    `cancelReason` TEXT NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ConsignmentPayment_idempotencyKey_key`(`idempotencyKey`),
    INDEX `ConsignmentPayment_cycleId_idx`(`cycleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConsignmentCommission` (
    `id` VARCHAR(191) NOT NULL,
    `cycleId` VARCHAR(191) NOT NULL,
    `spgUserId` VARCHAR(191) NOT NULL,
    `baseSalary` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `commission` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `total` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `deduction` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `paidAt` DATETIME(3) NULL,
    `paidById` VARCHAR(191) NULL,
    `note` MEDIUMTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ConsignmentCommission_cycleId_idx`(`cycleId`),
    INDEX `ConsignmentCommission_spgUserId_idx`(`spgUserId`),
    UNIQUE INDEX `ConsignmentCommission_cycleId_spgUserId_key`(`cycleId`, `spgUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Foto` (
    `id` VARCHAR(191) NOT NULL,
    `mime` VARCHAR(191) NOT NULL,
    `bytes` LONGBLOB NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `caption` VARCHAR(191) NULL,
    `uploadedById` VARCHAR(191) NULL,
    `sha256` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Foto_uploadedById_idx`(`uploadedById`),
    INDEX `Foto_createdAt_idx`(`createdAt`),
    INDEX `Foto_sha256_idx`(`sha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoreReturn` (
    `id` VARCHAR(191) NOT NULL,
    `noNrt` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `salesmanId` VARCHAR(191) NULL,
    `claimDate` DATETIME(3) NOT NULL,
    `deliveryMethod` ENUM('SALES', 'TOKO', 'EKSPEDISI') NOT NULL DEFAULT 'SALES',
    `claimedAmount` DECIMAL(15, 2) NOT NULL,
    `photoUrl` VARCHAR(191) NULL,
    `note` MEDIUMTEXT NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `replacesReturnId` VARCHAR(191) NULL,
    `reportedBySpg` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('MENUNGGU', 'COCOK', 'SELISIH', 'BATAL') NOT NULL DEFAULT 'MENUNGGU',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StoreReturn_idempotencyKey_key`(`idempotencyKey`),
    UNIQUE INDEX `StoreReturn_replacesReturnId_key`(`replacesReturnId`),
    INDEX `StoreReturn_storeId_status_idx`(`storeId`, `status`),
    INDEX `StoreReturn_status_idx`(`status`),
    INDEX `StoreReturn_claimDate_idx`(`claimDate`),
    UNIQUE INDEX `StoreReturn_storeId_noNrt_key`(`storeId`, `noNrt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoreReturnItem` (
    `id` VARCHAR(191) NOT NULL,
    `storeReturnId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
    `itemName` VARCHAR(191) NOT NULL,
    `qty` INTEGER NOT NULL,
    `price` DECIMAL(15, 2) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `condition` ENUM('LAYAK', 'RUSAK', 'EXPIRED') NOT NULL DEFAULT 'LAYAK',
    `storeReceiptLineId` VARCHAR(191) NULL,
    `spgSaleReturnLineId` VARCHAR(191) NULL,

    INDEX `StoreReturnItem_storeReturnId_idx`(`storeReturnId`),
    INDEX `StoreReturnItem_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WarehouseReturn` (
    `id` VARCHAR(191) NOT NULL,
    `noNri` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NULL,
    `storeReturnId` VARCHAR(191) NULL,
    `warehouseUserId` VARCHAR(191) NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL,
    `deliveryMethod` ENUM('SALES', 'TOKO', 'EKSPEDISI') NOT NULL DEFAULT 'SALES',
    `physicalAmount` DECIMAL(15, 2) NOT NULL,
    `claimedAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `note` MEDIUMTEXT NULL,
    `status` ENUM('DRAFT', 'FINAL') NOT NULL DEFAULT 'DRAFT',
    `finalisedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WarehouseReturn_noNri_key`(`noNri`),
    UNIQUE INDEX `WarehouseReturn_storeReturnId_key`(`storeReturnId`),
    INDEX `WarehouseReturn_storeId_status_idx`(`storeId`, `status`),
    INDEX `WarehouseReturn_status_idx`(`status`),
    INDEX `WarehouseReturn_receivedAt_idx`(`receivedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WarehouseReturnItem` (
    `id` VARCHAR(191) NOT NULL,
    `warehouseReturnId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
    `itemName` VARCHAR(191) NOT NULL,
    `qtyClaim` INTEGER NOT NULL DEFAULT 0,
    `qty` INTEGER NOT NULL,
    `price` DECIMAL(15, 2) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `condition` ENUM('LAYAK', 'RUSAK', 'EXPIRED') NOT NULL DEFAULT 'LAYAK',

    INDEX `WarehouseReturnItem_warehouseReturnId_idx`(`warehouseReturnId`),
    INDEX `WarehouseReturnItem_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReturnCharge` (
    `id` VARCHAR(191) NOT NULL,
    `storeReturnId` VARCHAR(191) NULL,
    `warehouseReturnId` VARCHAR(191) NULL,
    `storeId` VARCHAR(191) NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `bearer` ENUM('TOKO', 'SALES', 'GUDANG', 'PERUSAHAAN') NULL,
    `bearerUserId` VARCHAR(191) NULL,
    `status` ENUM('TERBUKA', 'DITETAPKAN', 'LUNAS') NOT NULL DEFAULT 'TERBUKA',
    `note` MEDIUMTEXT NULL,
    `decidedById` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `settledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ReturnCharge_status_idx`(`status`),
    INDEX `ReturnCharge_storeId_status_idx`(`storeId`, `status`),
    INDEX `ReturnCharge_bearerUserId_status_idx`(`bearerUserId`, `status`),
    INDEX `ReturnCharge_storeReturnId_idx`(`storeReturnId`),
    INDEX `ReturnCharge_warehouseReturnId_idx`(`warehouseReturnId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeductionType` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `method` ENUM('NOMINAL', 'PERSEN', 'DARI_RETUR') NOT NULL DEFAULT 'NOMINAL',
    `allowManual` BOOLEAN NOT NULL DEFAULT true,
    `pkpOnly` BOOLEAN NOT NULL DEFAULT false,
    `noteRequired` BOOLEAN NOT NULL DEFAULT false,
    `postingRole` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `DeductionType_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentClaimDeduction` (
    `id` VARCHAR(191) NOT NULL,
    `paymentClaimId` VARCHAR(191) NOT NULL,
    `deductionTypeId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `note` VARCHAR(191) NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `storeReturnId` VARCHAR(191) NULL,

    INDEX `PaymentClaimDeduction_paymentClaimId_idx`(`paymentClaimId`),
    INDEX `PaymentClaimDeduction_storeReturnId_idx`(`storeReturnId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Kol` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `niche` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `rateCard` DECIMAL(15, 2) NULL,
    `rateNote` TEXT NULL,
    `rateFormat` TEXT NULL,
    `note` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `label` TEXT NULL,
    `waNormal` VARCHAR(191) NULL,
    `recipientName` VARCHAR(191) NULL,
    `address` TEXT NULL,
    `province` VARCHAR(191) NULL,
    `postalCode` VARCHAR(191) NULL,
    `sizeProfile` TEXT NULL,
    `engagementRate` DECIMAL(6, 2) NULL,
    `avgViews` INTEGER NULL,
    `blockedAt` DATETIME(3) NULL,
    `blockReason` TEXT NULL,
    `lastContactAt` DATETIME(3) NULL,
    `jenisPajak` ENUM('ORANG_PRIBADI', 'BADAN', 'TIDAK_DIPOTONG') NOT NULL DEFAULT 'ORANG_PRIBADI',
    `alasanTidakDipotong` TEXT NULL,
    `adaNpwp` BOOLEAN NOT NULL DEFAULT false,
    `grossUpBawaan` BOOLEAN NOT NULL DEFAULT false,
    `bankNameEnc` TEXT NULL,
    `bankAccountEnc` TEXT NULL,
    `bankHolderEnc` TEXT NULL,
    `nikEnc` TEXT NULL,
    `npwpEnc` TEXT NULL,
    `bankLast4` VARCHAR(191) NULL,
    `nikLast4` VARCHAR(191) NULL,
    `dataPajakLengkap` BOOLEAN NOT NULL DEFAULT false,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Kol_isActive_name_idx`(`isActive`, `name`),
    INDEX `Kol_createdById_idx`(`createdById`),
    INDEX `Kol_waNormal_idx`(`waNormal`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolAccount` (
    `id` VARCHAR(191) NOT NULL,
    `kolId` VARCHAR(191) NOT NULL,
    `platform` ENUM('INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'LAINNYA', 'SHOPEE') NOT NULL,
    `handle` VARCHAR(191) NOT NULL,
    `followers` INTEGER NOT NULL DEFAULT 0,
    `url` VARCHAR(191) NULL,
    `er` DECIMAL(6, 2) NULL,
    `avgViews` INTEGER NULL,
    `erUpdatedAt` DATETIME(3) NULL,
    `platformUserId` VARCHAR(191) NULL,
    `lastCheckedAt` DATETIME(3) NULL,
    `checkStatus` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `KolAccount_kolId_idx`(`kolId`),
    UNIQUE INDEX `KolAccount_kolId_platform_handle_key`(`kolId`, `platform`, `handle`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolFollowerSnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `followers` INTEGER NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `source` VARCHAR(191) NULL,
    `er` DECIMAL(6, 2) NULL,
    `avgViews` INTEGER NULL,
    `postsCounted` INTEGER NULL,
    `perangkatId` VARCHAR(191) NULL,

    INDEX `KolFollowerSnapshot_accountId_idx`(`accountId`),
    INDEX `KolFollowerSnapshot_recordedAt_idx`(`recordedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolCampaign` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `brand` VARCHAR(191) NULL,
    `product` VARCHAR(191) NULL,
    `objective` TEXT NULL,
    `startDate` DATETIME(3) NULL,
    `endDate` DATETIME(3) NULL,
    `budget` DECIMAL(15, 2) NULL,
    `targetKol` INTEGER NULL,
    `targetContent` INTEGER NULL,
    `targetViews` INTEGER NULL,
    `status` ENUM('DRAFT', 'BERJALAN', 'SELESAI', 'BATAL') NOT NULL DEFAULT 'BERJALAN',
    `brief` TEXT NULL,
    `note` TEXT NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `KolCampaign_archivedAt_idx`(`archivedAt`),
    INDEX `KolCampaign_status_idx`(`status`),
    INDEX `KolCampaign_name_idx`(`name`),
    INDEX `KolCampaign_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolBrief` (
    `id` VARCHAR(191) NOT NULL,
    `docNo` VARCHAR(191) NOT NULL,
    `kolId` VARCHAR(191) NOT NULL,
    `tahap` ENUM('PROSPEK', 'DIHUBUNGI', 'NEGO', 'DEAL', 'BRIEF_DIKIRIM', 'SAMPEL_DIKIRIM', 'SAMPEL_DITERIMA', 'DRAF', 'DRAF_DISETUJUI', 'TAYANG', 'ANGKA_MASUK', 'DIBAYAR', 'SELESAI', 'DITOLAK', 'GHOSTING', 'BATAL') NOT NULL DEFAULT 'PROSPEK',
    `tahapAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `campaignId` VARCHAR(191) NULL,
    `jenis` ENUM('BARTER', 'BAYAR', 'CAMPURAN', 'KOMISI') NOT NULL DEFAULT 'BARTER',
    `fee` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `commissionPct` DECIMAL(5, 2) NULL,
    `picId` VARCHAR(191) NULL,
    `briefText` TEXT NULL,
    `doList` TEXT NULL,
    `dontList` TEXT NULL,
    `startDate` DATETIME(3) NULL,
    `dueDate` DATETIME(3) NULL,
    `outreachAt` DATETIME(3) NULL,
    `dealAt` DATETIME(3) NULL,
    `lastContactAt` DATETIME(3) NULL,
    `plannedLiveAt` DATETIME(3) NULL,
    `sentAt` DATETIME(3) NULL,
    `liveAt` DATETIME(3) NULL,
    `stockIssuedAt` DATETIME(3) NULL,
    `boostCost` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `payStatus` ENUM('TIDAK_PERLU', 'BELUM', 'SEBAGIAN', 'LUNAS') NOT NULL DEFAULT 'TIDAK_PERLU',
    `paidAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `paidAt` DATETIME(3) NULL,
    `payNote` TEXT NULL,
    `rating` INTEGER NULL,
    `modePajak` ENUM('DIPOTONG', 'GROSS_UP') NOT NULL DEFAULT 'DIPOTONG',
    `jurnalOtomatis` BOOLEAN NOT NULL DEFAULT true,
    `cancelReason` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `KolBrief_docNo_key`(`docNo`),
    INDEX `KolBrief_kolId_idx`(`kolId`),
    INDEX `KolBrief_tahap_idx`(`tahap`),
    INDEX `KolBrief_campaignId_idx`(`campaignId`),
    INDEX `KolBrief_picId_idx`(`picId`),
    INDEX `KolBrief_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolBriefDeliverable` (
    `id` VARCHAR(191) NOT NULL,
    `briefId` VARCHAR(191) NOT NULL,
    `platform` ENUM('INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'LAINNYA', 'SHOPEE') NOT NULL,
    `format` ENUM('FEED', 'REELS', 'STORY', 'VIDEO', 'LIVE', 'CAROUSEL') NOT NULL,
    `qty` INTEGER NOT NULL DEFAULT 1,
    `dueDate` DATETIME(3) NULL,

    INDEX `KolBriefDeliverable_briefId_idx`(`briefId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolBriefItem` (
    `id` VARCHAR(191) NOT NULL,
    `briefId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `itemName` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NULL,
    `qty` INTEGER NOT NULL DEFAULT 1,

    INDEX `KolBriefItem_briefId_idx`(`briefId`),
    INDEX `KolBriefItem_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolPaymentTerm` (
    `id` VARCHAR(191) NOT NULL,
    `collabId` VARCHAR(191) NOT NULL,
    `urutan` INTEGER NOT NULL DEFAULT 1,
    `label` VARCHAR(191) NOT NULL,
    `persen` DECIMAL(5, 2) NULL,
    `neto` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `bruto` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `pph` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `dpp` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `jenisPajak` ENUM('ORANG_PRIBADI', 'BADAN', 'TIDAK_DIPOTONG') NOT NULL DEFAULT 'ORANG_PRIBADI',
    `grossUp` BOOLEAN NOT NULL DEFAULT false,
    `tarifInfo` TEXT NULL,
    `pemicu` ENUM('DEAL', 'TAYANG', 'TANGGAL') NOT NULL DEFAULT 'TAYANG',
    `hariSesudah` INTEGER NOT NULL DEFAULT 0,
    `jatuhTempo` DATETIME(3) NULL,
    `status` ENUM('BELUM', 'DIBAYAR', 'BATAL') NOT NULL DEFAULT 'BELUM',
    `bayarKe` INTEGER NOT NULL DEFAULT 0,
    `dibayarAt` DATETIME(3) NULL,
    `dibayarOlehId` VARCHAR(191) NULL,
    `buktiTransferUrl` VARCHAR(191) NULL,
    `nomorBuktiPotong` VARCHAR(191) NULL,
    `buktiPotongAt` DATETIME(3) NULL,
    `setorAt` DATETIME(3) NULL,
    `ntpn` VARCHAR(191) NULL,
    `catatan` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `KolPaymentTerm_collabId_idx`(`collabId`),
    INDEX `KolPaymentTerm_status_idx`(`status`),
    INDEX `KolPaymentTerm_dibayarAt_idx`(`dibayarAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolShipment` (
    `id` VARCHAR(191) NOT NULL,
    `collabId` VARCHAR(191) NOT NULL,
    `courier` VARCHAR(191) NULL,
    `trackingNo` VARCHAR(191) NULL,
    `sentAt` DATETIME(3) NULL,
    `receivedAt` DATETIME(3) NULL,
    `shippingCost` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `stockIssuedAt` DATETIME(3) NULL,
    `note` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `KolShipment_collabId_idx`(`collabId`),
    INDEX `KolShipment_trackingNo_idx`(`trackingNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolShipmentLine` (
    `id` VARCHAR(191) NOT NULL,
    `shipmentId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `itemName` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NULL,
    `qty` INTEGER NOT NULL,
    `unitCost` DECIMAL(15, 2) NOT NULL DEFAULT 0,

    INDEX `KolShipmentLine_shipmentId_idx`(`shipmentId`),
    INDEX `KolShipmentLine_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolContent` (
    `id` VARCHAR(191) NOT NULL,
    `collabId` VARCHAR(191) NOT NULL,
    `platform` ENUM('INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'LAINNYA', 'SHOPEE') NOT NULL,
    `format` ENUM('FEED', 'REELS', 'STORY', 'VIDEO', 'LIVE', 'CAROUSEL') NOT NULL,
    `link` TEXT NULL,
    `liveAt` DATETIME(3) NULL,
    `plannedAt` DATETIME(3) NULL,
    `draftLink` TEXT NULL,
    `draftStatus` ENUM('MENUNGGU', 'REVISI', 'DISETUJUI') NULL,
    `draftNote` TEXT NULL,
    `draftAt` DATETIME(3) NULL,
    `approvedById` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `adCode` VARCHAR(191) NULL,
    `adCodeUntil` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `KolContent_collabId_idx`(`collabId`),
    INDEX `KolContent_liveAt_idx`(`liveAt`),
    INDEX `KolContent_plannedAt_idx`(`plannedAt`),
    INDEX `KolContent_approvedById_idx`(`approvedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolContentMetric` (
    `id` VARCHAR(191) NOT NULL,
    `contentId` VARCHAR(191) NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `views` INTEGER NOT NULL DEFAULT 0,
    `likes` INTEGER NOT NULL DEFAULT 0,
    `comments` INTEGER NOT NULL DEFAULT 0,
    `shares` INTEGER NOT NULL DEFAULT 0,
    `saves` INTEGER NOT NULL DEFAULT 0,
    `source` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `perangkatId` VARCHAR(191) NULL,

    INDEX `KolContentMetric_contentId_idx`(`contentId`),
    INDEX `KolContentMetric_recordedAt_idx`(`recordedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolSale` (
    `id` VARCHAR(191) NOT NULL,
    `collabId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `orders` INTEGER NOT NULL DEFAULT 0,
    `gmv` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `commission` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `source` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `KolSale_collabId_idx`(`collabId`),
    INDEX `KolSale_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolNote` (
    `id` VARCHAR(191) NOT NULL,
    `kolId` VARCHAR(191) NULL,
    `collabId` VARCHAR(191) NULL,
    `body` TEXT NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `KolNote_kolId_idx`(`kolId`),
    INDEX `KolNote_collabId_idx`(`collabId`),
    INDEX `KolNote_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolAgenda` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `time` VARCHAR(191) NULL,
    `kind` ENUM('TUGAS', 'MEETING', 'DEADLINE', 'KIRIM', 'KONTEN', 'BAYAR', 'LAINNYA') NOT NULL DEFAULT 'TUGAS',
    `checklist` TEXT NULL,
    `note` TEXT NULL,
    `campaignId` VARCHAR(191) NULL,
    `kolId` VARCHAR(191) NULL,
    `collabId` VARCHAR(191) NULL,
    `remindDaysBefore` INTEGER NOT NULL DEFAULT 0,
    `doneAt` DATETIME(3) NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `KolAgenda_date_idx`(`date`),
    INDEX `KolAgenda_ownerId_idx`(`ownerId`),
    INDEX `KolAgenda_campaignId_idx`(`campaignId`),
    INDEX `KolAgenda_kolId_idx`(`kolId`),
    INDEX `KolAgenda_collabId_idx`(`collabId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolPerangkat` (
    `id` VARCHAR(191) NOT NULL,
    `nama` VARCHAR(191) NOT NULL,
    `dibuatOlehId` VARCHAR(191) NOT NULL,
    `kodeHash` VARCHAR(191) NULL,
    `kodeBerlakuSampai` DATETIME(3) NULL,
    `tokenHash` VARCHAR(191) NULL,
    `tersambungAt` DATETIME(3) NULL,
    `terakhirLaporAt` DATETIME(3) NULL,
    `dicabutAt` DATETIME(3) NULL,
    `dijedaSampai` DATETIME(3) NULL,
    `alasanJeda` TEXT NULL,
    `versiEkstensi` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `KolPerangkat_kodeHash_key`(`kodeHash`),
    UNIQUE INDEX `KolPerangkat_tokenHash_key`(`tokenHash`),
    INDEX `KolPerangkat_dibuatOlehId_idx`(`dibuatOlehId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolFormLink` (
    `id` VARCHAR(191) NOT NULL,
    `kolId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `KolFormLink_tokenHash_key`(`tokenHash`),
    INDEX `KolFormLink_kolId_idx`(`kolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolBrandCollab` (
    `id` VARCHAR(191) NOT NULL,
    `kunci` VARCHAR(191) NOT NULL,
    `kolId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NULL,
    `platform` ENUM('INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'LAINNYA', 'SHOPEE') NOT NULL,
    `brandHandle` VARCHAR(191) NOT NULL,
    `brandName` VARCHAR(191) NULL,
    `jenis` ENUM('BERBAYAR', 'KOLABORASI', 'TAG') NOT NULL,
    `postId` VARCHAR(191) NULL,
    `postUrl` TEXT NULL,
    `postedAt` DATETIME(3) NULL,
    `caption` TEXT NULL,
    `views` INTEGER NULL,
    `sumber` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `KolBrandCollab_kunci_key`(`kunci`),
    INDEX `KolBrandCollab_kolId_postedAt_idx`(`kolId`, `postedAt`),
    INDEX `KolBrandCollab_brandHandle_idx`(`brandHandle`),
    INDEX `KolBrandCollab_accountId_idx`(`accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolCalendarFeed` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `KolCalendarFeed_tokenHash_key`(`tokenHash`),
    INDEX `KolCalendarFeed_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolFormSubmission` (
    `id` VARCHAR(191) NOT NULL,
    `linkId` VARCHAR(191) NOT NULL,
    `kolId` VARCHAR(191) NOT NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `changes` TEXT NOT NULL,
    `replacedCount` INTEGER NOT NULL DEFAULT 0,
    `reviewedAt` DATETIME(3) NULL,
    `reviewedById` VARCHAR(191) NULL,

    INDEX `KolFormSubmission_kolId_idx`(`kolId`),
    INDEX `KolFormSubmission_reviewedAt_idx`(`reviewedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolTugasPantau` (
    `id` VARCHAR(191) NOT NULL,
    `jenis` VARCHAR(191) NOT NULL,
    `platform` ENUM('INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'LAINNYA', 'SHOPEE') NOT NULL,
    `accountId` VARCHAR(191) NULL,
    `contentId` VARCHAR(191) NULL,
    `url` TEXT NOT NULL,
    `titikH` INTEGER NULL,
    `prioritas` INTEGER NOT NULL DEFAULT 0,
    `jatuhAt` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ANTRE',
    `perangkatId` VARCHAR(191) NULL,
    `pinjamSampai` DATETIME(3) NULL,
    `percobaan` INTEGER NOT NULL DEFAULT 0,
    `galatTerakhir` TEXT NULL,
    `selesaiAt` DATETIME(3) NULL,
    `kunci` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `KolTugasPantau_kunci_key`(`kunci`),
    INDEX `KolTugasPantau_status_jatuhAt_idx`(`status`, `jatuhAt`),
    INDEX `KolTugasPantau_perangkatId_idx`(`perangkatId`),
    INDEX `KolTugasPantau_accountId_idx`(`accountId`),
    INDEX `KolTugasPantau_contentId_idx`(`contentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolLogPantau` (
    `id` VARCHAR(191) NOT NULL,
    `perangkatId` VARCHAR(191) NULL,
    `tugasId` VARCHAR(191) NULL,
    `jenis` VARCHAR(191) NOT NULL,
    `kode` VARCHAR(191) NULL,
    `pesan` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `KolLogPantau_createdAt_idx`(`createdAt`),
    INDEX `KolLogPantau_perangkatId_idx`(`perangkatId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContentPlan` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `platform` ENUM('INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'LAINNYA', 'SHOPEE') NOT NULL,
    `format` ENUM('FEED', 'REELS', 'STORY', 'VIDEO', 'LIVE', 'CAROUSEL') NOT NULL,
    `status` ENUM('IDE', 'DRAFT', 'REVIEW', 'DIJADWALKAN', 'TAYANG', 'BATAL') NOT NULL DEFAULT 'IDE',
    `scheduledAt` DATETIME(3) NULL,
    `publishedAt` DATETIME(3) NULL,
    `postUrl` VARCHAR(191) NULL,
    `imageUrl` VARCHAR(191) NULL,
    `caption` TEXT NULL,
    `note` TEXT NULL,
    `itemId` VARCHAR(191) NULL,
    `assigneeId` VARCHAR(191) NULL,
    `briefId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ContentPlan_status_scheduledAt_idx`(`status`, `scheduledAt`),
    INDEX `ContentPlan_briefId_idx`(`briefId`),
    INDEX `ContentPlan_itemId_idx`(`itemId`),
    INDEX `ContentPlan_assigneeId_idx`(`assigneeId`),
    INDEX `ContentPlan_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ColorPalette` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `harmony` VARCHAR(191) NOT NULL,
    `colors` JSON NOT NULL,
    `fabricHex` VARCHAR(191) NULL,
    `portions` JSON NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ColorPalette_createdAt_idx`(`createdAt`),
    INDEX `ColorPalette_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoreRecommendation` (
    `id` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `salesmanId` VARCHAR(191) NOT NULL,
    `status` ENUM('TERKIRIM', 'DITERIMA', 'DITOLAK', 'SELESAI', 'DIBATALKAN') NOT NULL DEFAULT 'TERKIRIM',
    `note` TEXT NULL,
    `respondedById` VARCHAR(191) NULL,
    `respondedAt` DATETIME(3) NULL,
    `responseNote` TEXT NULL,
    `fieldSalesOrderId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StoreRecommendation_idempotencyKey_key`(`idempotencyKey`),
    INDEX `StoreRecommendation_storeId_status_idx`(`storeId`, `status`),
    INDEX `StoreRecommendation_salesmanId_createdAt_idx`(`salesmanId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoreRecommendationLine` (
    `id` VARCHAR(191) NOT NULL,
    `recommendationId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
    `productName` VARCHAR(191) NOT NULL,
    `qty` INTEGER NOT NULL,
    `alasan` VARCHAR(191) NULL,

    INDEX `StoreRecommendationLine_recommendationId_idx`(`recommendationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoreStockMovement` (
    `id` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
    `qty` INTEGER NOT NULL,
    `kind` ENUM('TERIMA', 'JUAL', 'OPNAME', 'MUTASI_KELUAR', 'MUTASI_MASUK', 'RETUR_KELUAR', 'RETUR_PEMBELI', 'HILANG') NOT NULL,
    `refType` VARCHAR(191) NULL,
    `refId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StoreStockMovement_storeId_itemId_variantSku_idx`(`storeId`, `itemId`, `variantSku`),
    INDEX `StoreStockMovement_storeId_createdAt_idx`(`storeId`, `createdAt`),
    INDEX `StoreStockMovement_refType_refId_idx`(`refType`, `refId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoreReceipt` (
    `id` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `sourceType` VARCHAR(191) NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `sourceDocNo` VARCHAR(191) NOT NULL,
    `receivedById` VARCHAR(191) NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `idempotencyKey` VARCHAR(191) NULL,
    `note` MEDIUMTEXT NULL,

    UNIQUE INDEX `StoreReceipt_idempotencyKey_key`(`idempotencyKey`),
    INDEX `StoreReceipt_storeId_receivedAt_idx`(`storeId`, `receivedAt`),
    UNIQUE INDEX `StoreReceipt_sourceType_sourceId_key`(`sourceType`, `sourceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoreReceiptLine` (
    `id` VARCHAR(191) NOT NULL,
    `receiptId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
    `productName` VARCHAR(191) NOT NULL,
    `qtySent` INTEGER NOT NULL,
    `qtyReceived` INTEGER NOT NULL,
    `qtyDamaged` INTEGER NOT NULL DEFAULT 0,
    `damageNote` TEXT NULL,
    `damagePhotoUrl` VARCHAR(191) NULL,
    `damageStatus` VARCHAR(191) NULL,
    `damageDecidedById` VARCHAR(191) NULL,
    `damageDecidedAt` DATETIME(3) NULL,
    `damageDecisionNote` TEXT NULL,

    INDEX `StoreReceiptLine_receiptId_idx`(`receiptId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoreOpname` (
    `id` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `countedById` VARCHAR(191) NOT NULL,
    `countedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `idempotencyKey` VARCHAR(191) NULL,
    `note` MEDIUMTEXT NULL,

    UNIQUE INDEX `StoreOpname_idempotencyKey_key`(`idempotencyKey`),
    INDEX `StoreOpname_storeId_countedAt_idx`(`storeId`, `countedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoreOpnameLine` (
    `id` VARCHAR(191) NOT NULL,
    `opnameId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
    `productName` VARCHAR(191) NOT NULL,
    `qtySystem` INTEGER NOT NULL,
    `qtyCounted` INTEGER NOT NULL,
    `countedAt` DATETIME(3) NULL,

    INDEX `StoreOpnameLine_opnameId_idx`(`opnameId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockRequest` (
    `id` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `requestedById` VARCHAR(191) NOT NULL,
    `status` ENUM('BARU', 'DIPROSES', 'SELESAI', 'DITOLAK') NOT NULL DEFAULT 'BARU',
    `note` MEDIUMTEXT NULL,
    `handledById` VARCHAR(191) NULL,
    `handledAt` DATETIME(3) NULL,
    `handleNote` MEDIUMTEXT NULL,
    `fieldSalesOrderId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StockRequest_idempotencyKey_key`(`idempotencyKey`),
    INDEX `StockRequest_storeId_status_idx`(`storeId`, `status`),
    INDEX `StockRequest_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `StockRequest_fieldSalesOrderId_idx`(`fieldSalesOrderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockRequestLine` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
    `productName` VARCHAR(191) NOT NULL,
    `qty` INTEGER NOT NULL,
    `alasan` VARCHAR(191) NULL,

    INDEX `StockRequestLine_requestId_idx`(`requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LostSale` (
    `id` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
    `description` TEXT NOT NULL,
    `qty` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LostSale_storeId_createdAt_idx`(`storeId`, `createdAt`),
    INDEX `LostSale_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoreProposal` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `address` TEXT NOT NULL,
    `phone` VARCHAR(191) NULL,
    `contactName` VARCHAR(191) NULL,
    `termsType` ENUM('PUTUS', 'KONSI') NULL,
    `groupId` VARCHAR(191) NULL,
    `lat` DECIMAL(10, 7) NULL,
    `lng` DECIMAL(10, 7) NULL,
    `photoUrl` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `proposedById` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` TEXT NULL,
    `storeId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StoreProposal_idempotencyKey_key`(`idempotencyKey`),
    INDEX `StoreProposal_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `StoreProposal_proposedById_idx`(`proposedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoreStockTarget` (
    `id` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
    `minQty` INTEGER NOT NULL,
    `maxQty` INTEGER NOT NULL,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StoreStockTarget_storeId_idx`(`storeId`),
    UNIQUE INDEX `StoreStockTarget_storeId_itemId_variantSku_key`(`storeId`, `itemId`, `variantSku`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExpenseClaim` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `spentAt` DATETIME(3) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `photoUrl` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `visitId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DIAJUKAN',
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` TEXT NULL,
    `paidById` VARCHAR(191) NULL,
    `paidAt` DATETIME(3) NULL,
    `paidAccountId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ExpenseClaim_idempotencyKey_key`(`idempotencyKey`),
    INDEX `ExpenseClaim_userId_spentAt_idx`(`userId`, `spentAt`),
    INDEX `ExpenseClaim_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Attendance` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `dayKey` VARCHAR(191) NOT NULL,
    `clockInAt` DATETIME(3) NOT NULL,
    `clockInLat` DECIMAL(10, 7) NULL,
    `clockInLng` DECIMAL(10, 7) NULL,
    `clockInAccuracy` INTEGER NULL,
    `selfieUrl` VARCHAR(191) NULL,
    `clockOutAt` DATETIME(3) NULL,
    `clockOutLat` DECIMAL(10, 7) NULL,
    `clockOutLng` DECIMAL(10, 7) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Attendance_dayKey_idx`(`dayKey`),
    UNIQUE INDEX `Attendance_userId_dayKey_key`(`userId`, `dayKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PreorderWindow` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `note` TEXT NULL,
    `opensAt` DATETIME(3) NOT NULL,
    `closesAt` DATETIME(3) NOT NULL,
    `shipFrom` DATETIME(3) NULL,
    `shipTo` DATETIME(3) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `releasedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PreorderWindow_isActive_closesAt_idx`(`isActive`, `closesAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PreorderWindowItem` (
    `id` VARCHAR(191) NOT NULL,
    `windowId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `plannedQty` INTEGER NULL,

    INDEX `PreorderWindowItem_itemId_idx`(`itemId`),
    UNIQUE INDEX `PreorderWindowItem_windowId_itemId_key`(`windowId`, `itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VisitChecklistTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `termsType` ENUM('PUTUS', 'KONSI') NULL,
    `questions` JSON NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VisitChecklistResult` (
    `id` VARCHAR(191) NOT NULL,
    `visitId` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `answers` JSON NOT NULL,
    `score` INTEGER NOT NULL,
    `maxScore` INTEGER NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `VisitChecklistResult_templateId_idx`(`templateId`),
    UNIQUE INDEX `VisitChecklistResult_visitId_templateId_key`(`visitId`, `templateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitorPrice` (
    `id` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `visitId` VARCHAR(191) NULL,
    `brand` VARCHAR(191) NOT NULL,
    `productName` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NULL,
    `price` DECIMAL(15, 2) NOT NULL,
    `photoUrl` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CompetitorPrice_storeId_createdAt_idx`(`storeId`, `createdAt`),
    INDEX `CompetitorPrice_brand_idx`(`brand`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DisplayGuide` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `imageUrl` VARCHAR(191) NULL,
    `termsType` ENUM('PUTUS', 'KONSI') NULL,
    `groupId` VARCHAR(191) NULL,
    `activeFrom` DATETIME(3) NULL,
    `activeTo` DATETIME(3) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CollectionTask` (
    `id` VARCHAR(191) NOT NULL,
    `assigneeId` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `receivableIds` JSON NOT NULL,
    `note` TEXT NULL,
    `dueDate` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'TERBUKA',
    `createdById` VARCHAR(191) NOT NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CollectionTask_assigneeId_status_idx`(`assigneeId`, `status`),
    INDEX `CollectionTask_storeId_idx`(`storeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoreExchange` (
    `id` VARCHAR(191) NOT NULL,
    `docNo` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `salesmanId` VARCHAR(191) NOT NULL,
    `visitId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DIAJUKAN',
    `note` TEXT NULL,
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` TEXT NULL,
    `completedAt` DATETIME(3) NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StoreExchange_docNo_key`(`docNo`),
    UNIQUE INDEX `StoreExchange_idempotencyKey_key`(`idempotencyKey`),
    INDEX `StoreExchange_storeId_createdAt_idx`(`storeId`, `createdAt`),
    INDEX `StoreExchange_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoreExchangeLine` (
    `id` VARCHAR(191) NOT NULL,
    `exchangeId` VARCHAR(191) NOT NULL,
    `direction` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
    `productName` VARCHAR(191) NOT NULL,
    `qty` INTEGER NOT NULL,

    INDEX `StoreExchangeLine_exchangeId_idx`(`exchangeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StorePortalLink` (
    `id` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `StorePortalLink_tokenHash_key`(`tokenHash`),
    INDEX `StorePortalLink_storeId_idx`(`storeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VisitSchedule` (
    `id` VARCHAR(191) NOT NULL,
    `salesmanId` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `dayKey` VARCHAR(191) NOT NULL,
    `note` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `VisitSchedule_dayKey_idx`(`dayKey`),
    INDEX `VisitSchedule_storeId_idx`(`storeId`),
    UNIQUE INDEX `VisitSchedule_salesmanId_storeId_dayKey_key`(`salesmanId`, `storeId`, `dayKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Announcement` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `audience` VARCHAR(191) NOT NULL DEFAULT 'SEMUA',
    `requireAck` BOOLEAN NOT NULL DEFAULT false,
    `pinned` BOOLEAN NOT NULL DEFAULT false,
    `publishedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Announcement_publishedAt_idx`(`publishedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AnnouncementRead` (
    `id` VARCHAR(191) NOT NULL,
    `announcementId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `readAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ackAt` DATETIME(3) NULL,

    INDEX `AnnouncementRead_userId_idx`(`userId`),
    UNIQUE INDEX `AnnouncementRead_announcementId_userId_key`(`announcementId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaveRequest` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `startDay` VARCHAR(191) NOT NULL,
    `endDay` VARCHAR(191) NOT NULL,
    `reason` TEXT NOT NULL,
    `photoUrl` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DIAJUKAN',
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` TEXT NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `LeaveRequest_idempotencyKey_key`(`idempotencyKey`),
    INDEX `LeaveRequest_userId_startDay_idx`(`userId`, `startDay`),
    INDEX `LeaveRequest_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesTarget` (
    `id` VARCHAR(191) NOT NULL,
    `salesmanId` VARCHAR(191) NOT NULL,
    `month` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(191) NOT NULL,
    `refId` VARCHAR(191) NOT NULL,
    `measure` VARCHAR(191) NOT NULL DEFAULT 'NILAI',
    `value` DECIMAL(15, 2) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SalesTarget_month_idx`(`month`),
    UNIQUE INDEX `SalesTarget_salesmanId_month_scope_refId_key`(`salesmanId`, `month`, `scope`, `refId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoreNote` (
    `id` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `pinned` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `StoreNote_storeId_deletedAt_idx`(`storeId`, `deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CounterPromo` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `value` DECIMAL(15, 2) NULL,
    `buyQty` INTEGER NULL,
    `freeQty` INTEGER NULL,
    `minSubtotal` DECIMAL(15, 2) NULL,
    `allItems` BOOLEAN NOT NULL DEFAULT true,
    `allStores` BOOLEAN NOT NULL DEFAULT true,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `memberOnly` BOOLEAN NOT NULL DEFAULT false,
    `note` TEXT NULL,
    `storeSharePercent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CounterPromo_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CounterPromoTarget` (
    `id` VARCHAR(191) NOT NULL,
    `promoId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `refId` VARCHAR(191) NOT NULL,
    `qty` INTEGER NULL,

    INDEX `CounterPromoTarget_kind_refId_idx`(`kind`, `refId`),
    UNIQUE INDEX `CounterPromoTarget_promoId_kind_refId_key`(`promoId`, `kind`, `refId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoreCustomer` (
    `id` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `note` TEXT NULL,
    `consentAt` DATETIME(3) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StoreCustomer_storeId_name_idx`(`storeId`, `name`),
    UNIQUE INDEX `StoreCustomer_storeId_phone_key`(`storeId`, `phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Member` (
    `id` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `consentAt` DATETIME(3) NOT NULL,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `joinedStoreId` VARCHAR(191) NOT NULL,
    `joinedById` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `deactivatedAt` DATETIME(3) NULL,
    `deactivatedById` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Member_phone_key`(`phone`),
    INDEX `Member_joinedStoreId_idx`(`joinedStoreId`),
    INDEX `Member_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SpgSalePromo` (
    `id` VARCHAR(191) NOT NULL,
    `spgSaleId` VARCHAR(191) NOT NULL,
    `spgSaleLineId` VARCHAR(191) NULL,
    `promoId` VARCHAR(191) NULL,
    `promoName` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `qty` INTEGER NOT NULL DEFAULT 0,
    `discount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `storeDiscount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SpgSalePromo_spgSaleId_idx`(`spgSaleId`),
    INDEX `SpgSalePromo_promoId_idx`(`promoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerRequest` (
    `id` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
    `description` TEXT NOT NULL,
    `qty` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(191) NOT NULL DEFAULT 'MENUNGGU',
    `holdUntil` VARCHAR(191) NULL,
    `availableAt` DATETIME(3) NULL,
    `notifiedAt` DATETIME(3) NULL,
    `notifiedById` VARCHAR(191) NULL,
    `closedAt` DATETIME(3) NULL,
    `closedById` VARCHAR(191) NULL,
    `closeReason` TEXT NULL,
    `spgSaleId` VARCHAR(191) NULL,
    `lostSaleId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CustomerRequest_idempotencyKey_key`(`idempotencyKey`),
    INDEX `CustomerRequest_storeId_status_idx`(`storeId`, `status`),
    INDEX `CustomerRequest_customerId_idx`(`customerId`),
    INDEX `CustomerRequest_itemId_variantSku_idx`(`itemId`, `variantSku`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SpgDailyClose` (
    `id` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `day` VARCHAR(191) NOT NULL,
    `closedById` VARCHAR(191) NOT NULL,
    `notaCount` INTEGER NOT NULL,
    `pcs` INTEGER NOT NULL,
    `returnPcs` INTEGER NOT NULL DEFAULT 0,
    `grossTotal` DECIMAL(15, 2) NOT NULL,
    `discountTotal` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `netTotal` DECIMAL(15, 2) NOT NULL,
    `visitorCount` INTEGER NULL,
    `cashierTotal` DECIMAL(15, 2) NULL,
    `note` TEXT NULL,
    `photoUrls` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SpgDailyClose_day_idx`(`day`),
    UNIQUE INDEX `SpgDailyClose_storeId_day_key`(`storeId`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SpgShift` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `day` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `shiftCode` VARCHAR(191) NULL,
    `startTime` VARCHAR(191) NULL,
    `endTime` VARCHAR(191) NULL,
    `note` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SpgShift_storeId_day_idx`(`storeId`, `day`),
    UNIQUE INDEX `SpgShift_userId_day_key`(`userId`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SpgShiftSwap` (
    `id` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `requesterId` VARCHAR(191) NOT NULL,
    `partnerId` VARCHAR(191) NOT NULL,
    `day` VARCHAR(191) NOT NULL,
    `partnerDay` VARCHAR(191) NULL,
    `reason` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'MENUNGGU_REKAN',
    `partnerAnsweredAt` DATETIME(3) NULL,
    `decidedById` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionNote` TEXT NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SpgShiftSwap_idempotencyKey_key`(`idempotencyKey`),
    INDEX `SpgShiftSwap_storeId_status_idx`(`storeId`, `status`),
    INDEX `SpgShiftSwap_requesterId_idx`(`requesterId`),
    INDEX `SpgShiftSwap_partnerId_idx`(`partnerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SizeChart` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NULL,
    `unit` VARCHAR(191) NOT NULL DEFAULT 'cm',
    `columns` JSON NOT NULL,
    `rows` JSON NOT NULL,
    `note` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SizeChart_categoryId_idx`(`categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SpgCommission` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `period` VARCHAR(191) NOT NULL,
    `unitsSold` INTEGER NOT NULL,
    `commission` DECIMAL(15, 2) NOT NULL,
    `deduction` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `basis` VARCHAR(191) NOT NULL,
    `lockedById` VARCHAR(191) NOT NULL,
    `lockedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `paidAt` DATETIME(3) NULL,
    `paidById` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SpgCommission_period_idx`(`period`),
    UNIQUE INDEX `SpgCommission_userId_storeId_period_key`(`userId`, `storeId`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DamagedStockMovement` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
    `productName` VARCHAR(191) NOT NULL,
    `qty` INTEGER NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `refType` VARCHAR(191) NULL,
    `refId` VARCHAR(191) NULL,
    `value` DECIMAL(15, 2) NULL,
    `note` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DamagedStockMovement_itemId_variantSku_idx`(`itemId`, `variantSku`),
    INDEX `DamagedStockMovement_refType_refId_idx`(`refType`, `refId`),
    INDEX `DamagedStockMovement_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockLoss` (
    `id` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NULL,
    `source` VARCHAR(191) NOT NULL,
    `sourceId` VARCHAR(191) NULL,
    `sourceDocNo` VARCHAR(191) NULL,
    `totalQty` INTEGER NOT NULL,
    `totalAmount` DECIMAL(15, 2) NOT NULL,
    `valueBasis` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'TERBUKA',
    `note` TEXT NULL,
    `decidedById` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionNote` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StockLoss_idempotencyKey_key`(`idempotencyKey`),
    INDEX `StockLoss_storeId_status_idx`(`storeId`, `status`),
    INDEX `StockLoss_source_sourceId_idx`(`source`, `sourceId`),
    INDEX `StockLoss_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockLossLine` (
    `id` VARCHAR(191) NOT NULL,
    `lossId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
    `productName` VARCHAR(191) NOT NULL,
    `qty` INTEGER NOT NULL,
    `unitValue` DECIMAL(15, 2) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,

    INDEX `StockLossLine_lossId_idx`(`lossId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockLossShare` (
    `id` VARCHAR(191) NOT NULL,
    `lossId` VARCHAR(191) NOT NULL,
    `bearer` VARCHAR(191) NOT NULL,
    `bearerUserId` VARCHAR(191) NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `settledAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `settledAt` DATETIME(3) NULL,
    `settledById` VARCHAR(191) NULL,
    `settleNote` TEXT NULL,

    INDEX `StockLossShare_lossId_idx`(`lossId`),
    INDEX `StockLossShare_bearerUserId_settledAt_idx`(`bearerUserId`, `settledAt`),
    INDEX `StockLossShare_bearer_settledAt_idx`(`bearer`, `settledAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SpgVisitorCount` (
    `id` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `day` VARCHAR(191) NOT NULL,
    `count` INTEGER NOT NULL,
    `clientUpdatedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SpgVisitorCount_storeId_day_idx`(`storeId`, `day`),
    UNIQUE INDEX `SpgVisitorCount_storeId_userId_day_key`(`storeId`, `userId`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockLossDeduction` (
    `id` VARCHAR(191) NOT NULL,
    `shareId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `refType` VARCHAR(191) NOT NULL,
    `refId` VARCHAR(191) NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StockLossDeduction_shareId_idx`(`shareId`),
    INDEX `StockLossDeduction_refType_refId_idx`(`refType`, `refId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `SupplierType_colorTcx_idx` ON `SupplierType`(`colorTcx`);

-- CreateIndex
CREATE INDEX `Store_groupId_idx` ON `Store`(`groupId`);

-- CreateIndex
CREATE INDEX `Store_salesmanId_idx` ON `Store`(`salesmanId`);

-- CreateIndex
CREATE UNIQUE INDEX `StoreVisit_clientId_key` ON `StoreVisit`(`clientId`);

-- CreateIndex
CREATE INDEX `FieldSalesOrder_replacesOrderId_idx` ON `FieldSalesOrder`(`replacesOrderId`);

-- CreateIndex
CREATE INDEX `FieldSalesOrder_preorderWindowId_idx` ON `FieldSalesOrder`(`preorderWindowId`);

-- CreateIndex
CREATE UNIQUE INDEX `Receivable_invoiceNo_key` ON `Receivable`(`invoiceNo`);

-- CreateIndex
CREATE INDEX `Receivable_storeId_outstanding_idx` ON `Receivable`(`storeId`, `outstanding`);

-- CreateIndex
CREATE INDEX `Receivable_salesmanId_idx` ON `Receivable`(`salesmanId`);

-- CreateIndex
CREATE UNIQUE INDEX `StoreTransfer_idempotencyKey_key` ON `StoreTransfer`(`idempotencyKey`);

-- CreateIndex
CREATE INDEX `StoreTransfer_fromStoreId_status_idx` ON `StoreTransfer`(`fromStoreId`, `status`);

-- CreateIndex
CREATE INDEX `StoreTransfer_toStoreId_status_idx` ON `StoreTransfer`(`toStoreId`, `status`);

-- CreateIndex
CREATE INDEX `StoreTransfer_status_createdAt_idx` ON `StoreTransfer`(`status`, `createdAt`);

-- CreateIndex
CREATE INDEX `PurchaseOrder_planStageId_idx` ON `PurchaseOrder`(`planStageId`);

-- CreateIndex
CREATE UNIQUE INDEX `GRN_idempotencyKey_key` ON `GRN`(`idempotencyKey`);

-- CreateIndex
CREATE UNIQUE INDEX `MaterialIssue_idempotencyKey_key` ON `MaterialIssue`(`idempotencyKey`);

-- CreateIndex
CREATE INDEX `VendorReturn_poId_idx` ON `VendorReturn`(`poId`);

-- CreateIndex
CREATE INDEX `SpgSale_customerId_idx` ON `SpgSale`(`customerId`);

-- CreateIndex
CREATE INDEX `SpgSale_memberId_idx` ON `SpgSale`(`memberId`);

-- CreateIndex
CREATE UNIQUE INDEX `Journal_reversalOfId_key` ON `Journal`(`reversalOfId`);

-- CreateIndex
CREATE INDEX `Journal_status_date_idx` ON `Journal`(`status`, `date`);

-- CreateIndex
CREATE INDEX `JournalLine_channel_idx` ON `JournalLine`(`channel`);

-- CreateIndex
CREATE INDEX `JournalLine_storeId_idx` ON `JournalLine`(`storeId`);
