-- Potongan beban barang hilang dan penghitung pengunjung SPG (MariaDB).
-- Setara 27_potongan_pengunjung di sisi Postgres; alasannya ditulis di sana.
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.

ALTER TABLE `ConsignmentCommission` ADD COLUMN `deduction` DECIMAL(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE `SpgCommission` ADD COLUMN `deduction` DECIMAL(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE `StockLossShare` ADD COLUMN `settledAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0;

CREATE TABLE `SpgVisitorCount` (
    `id` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `day` VARCHAR(191) NOT NULL,
    `count` INTEGER NOT NULL,
    `clientUpdatedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SpgVisitorCount_storeId_userId_day_key`(`storeId`, `userId`, `day`),
    INDEX `SpgVisitorCount_storeId_day_idx`(`storeId`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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
