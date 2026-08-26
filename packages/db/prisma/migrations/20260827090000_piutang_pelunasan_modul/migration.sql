-- Modul piutang & pelunasan pada MariaDB.
--
-- Setara dengan delapan migrasi Postgres di `prisma/postgres/migrations/`
-- (1_piutang_pelunasan sampai 8_toko_pkp), digabung jadi satu karena di sisi
-- MariaDB modulnya belum pernah ada sama sekali — tidak ada keadaan antara
-- yang perlu dilewati satu per satu.
--
-- KENAPA INI PENTING: kedua `schema` sudah memuat modelnya, tapi jejak migrasi
-- MariaDB berhenti jauh sebelum modul ini. Artinya `migrate deploy` di sana
-- melaporkan "tidak ada yang tertunda" sambil klien Prisma menunggu tabel yang
-- tidak pernah dibuat — persis bentuk berbahaya yang sudah pernah menimpa
-- repo ini: skema bergerak maju sementara aplikasinya diam-diam tertinggal.
--
-- Disusun dengan `prisma migrate diff` dari `master`, bukan diterjemahkan
-- tangan dari SQL Postgres. Terjemahan tangan atas 567 baris pasti meleset di
-- satu kolom, dan kolom yang meleset di modul uang tidak terlihat sampai
-- angkanya sudah salah.
--
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun. Dibuat supaya jejaknya tidak
-- bolong, bukan karena sudah terbukti di sana — cabang ini berjalan di
-- PostgreSQL. Yang pertama menerapkannya harus memeriksa hasilnya sendiri.
-- AlterTable
ALTER TABLE `Store` ADD COLUMN `isPkp` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `Item` ADD COLUMN `commissionPerPcs` DECIMAL(15, 2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `Receivable` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceNo` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `invoiceDate` DATETIME(3) NOT NULL,
    `dueDate` DATETIME(3) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `outstanding` DECIMAL(15, 2) NOT NULL,
    `settledAt` DATETIME(3) NULL,
    `source` ENUM('DELIVERY', 'IMPORT', 'MANUAL') NOT NULL DEFAULT 'DELIVERY',
    `deliveryId` VARCHAR(191) NULL,
    `salesmanId` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Receivable_invoiceNo_key`(`invoiceNo`),
    UNIQUE INDEX `Receivable_deliveryId_key`(`deliveryId`),
    INDEX `Receivable_storeId_outstanding_idx`(`storeId`, `outstanding`),
    INDEX `Receivable_dueDate_idx`(`dueDate`),
    INDEX `Receivable_salesmanId_idx`(`salesmanId`),
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
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CollectionNote_docNo_key`(`docNo`),
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
    `status` ENUM('DIKIRIM', 'TERVERIFIKASI', 'DITOLAK', 'DIBATALKAN') NOT NULL DEFAULT 'DIKIRIM',
    `verifiedById` VARCHAR(191) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `verifyNote` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PaymentClaim_docNo_key`(`docNo`),
    INDEX `PaymentClaim_storeId_status_idx`(`storeId`, `status`),
    INDEX `PaymentClaim_status_createdAt_idx`(`status`, `createdAt`),
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
CREATE TABLE `ConsignmentCommission` (
    `id` VARCHAR(191) NOT NULL,
    `cycleId` VARCHAR(191) NOT NULL,
    `spgUserId` VARCHAR(191) NOT NULL,
    `baseSalary` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `commission` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `total` DECIMAL(15, 2) NOT NULL DEFAULT 0,
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
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Foto_uploadedById_idx`(`uploadedById`),
    INDEX `Foto_createdAt_idx`(`createdAt`),
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
    `status` ENUM('MENUNGGU', 'COCOK', 'SELISIH', 'BATAL') NOT NULL DEFAULT 'MENUNGGU',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

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
    `itemName` VARCHAR(191) NOT NULL,
    `qty` INTEGER NOT NULL,
    `price` DECIMAL(15, 2) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,

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

