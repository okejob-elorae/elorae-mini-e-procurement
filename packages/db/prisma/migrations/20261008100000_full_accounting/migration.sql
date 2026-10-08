-- Akuntansi & pajak lengkap — fondasi (MariaDB). Setara 39_akuntansi_lengkap
-- di sisi Postgres; isi dan alasannya ditulis di sana.
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.
-- DDL MariaDB tidak transaksional: berkas yang gagal di tengah jalan tetap
-- setengah terpasang. Journal.status NOT NULL DEFAULT 'POSTED' menyalin tabel
-- Journal sekali (prod: 0 jurnal per 2026-08-08, jadi murah).

-- AlterTable
ALTER TABLE `Supplier` ADD COLUMN `hasNpwp` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `npwpEnc` TEXT NULL,
    ADD COLUMN `npwpLast4` VARCHAR(191) NULL,
    ADD COLUMN `taxWithholding` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `GRN` ADD COLUMN `ppnAmount` DECIMAL(15, 2) NULL;

-- AlterTable
ALTER TABLE `FGReceipt` ADD COLUMN `additionalCost` DECIMAL(15, 2) NULL,
    ADD COLUMN `serviceCost` DECIMAL(15, 2) NULL;

-- AlterTable
ALTER TABLE `DocNumberConfig` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE', 'VANRECON', 'SPGSALE', 'DELIVERY', 'CASHOUT', 'CASHIN', 'CASHTRF', 'SUPPAY', 'ASSET') NOT NULL;

-- AlterTable
ALTER TABLE `DocumentNumber` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE', 'VANRECON', 'SPGSALE', 'DELIVERY', 'CASHOUT', 'CASHIN', 'CASHTRF', 'SUPPAY', 'ASSET') NOT NULL;

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

-- AlterTable
ALTER TABLE `DeductionType` ADD COLUMN `postingRole` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `ExpenseClaim` ADD COLUMN `paidAccountId` VARCHAR(191) NULL;

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

-- CreateIndex
CREATE UNIQUE INDEX `Journal_reversalOfId_key` ON `Journal`(`reversalOfId`);

-- CreateIndex
CREATE INDEX `Journal_status_date_idx` ON `Journal`(`status`, `date`);

-- CreateIndex
CREATE INDEX `JournalLine_channel_idx` ON `JournalLine`(`channel`);

-- CreateIndex
CREATE INDEX `JournalLine_storeId_idx` ON `JournalLine`(`storeId`);

