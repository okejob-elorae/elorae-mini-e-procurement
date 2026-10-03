-- SPG: kirim barang antar toko (mutasi) dan retur (MariaDB). Setara
-- 23_spg_mutasi_retur di sisi Postgres; alasannya ditulis di sana.
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.

ALTER TABLE `StoreStockMovement` MODIFY `kind` ENUM('TERIMA', 'JUAL', 'OPNAME', 'MUTASI_KELUAR', 'MUTASI_MASUK', 'RETUR_KELUAR', 'RETUR_PEMBELI') NOT NULL;

CREATE TABLE `StoreTransfer` (
    `id` VARCHAR(191) NOT NULL,
    `docNo` VARCHAR(191) NOT NULL,
    `fromStoreId` VARCHAR(191) NOT NULL,
    `toStoreId` VARCHAR(191) NOT NULL,
    `status` ENUM('DIAJUKAN', 'DISETUJUI', 'DIKIRIM', 'DITERIMA', 'DITOLAK', 'DIBATALKAN', 'DIKEMBALIKAN') NOT NULL DEFAULT 'DIAJUKAN',
    `reason` TEXT NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `approvedById` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `reviewNote` TEXT NULL,
    `shippedById` VARCHAR(191) NULL,
    `shippedAt` DATETIME(3) NULL,
    `cancelledById` VARCHAR(191) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `selisihStatus` ENUM('TERBUKA', 'HILANG', 'KEMBALI') NULL,
    `selisihNote` TEXT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StoreTransfer_docNo_key`(`docNo`),
    UNIQUE INDEX `StoreTransfer_idempotencyKey_key`(`idempotencyKey`),
    INDEX `StoreTransfer_fromStoreId_status_idx`(`fromStoreId`, `status`),
    INDEX `StoreTransfer_toStoreId_status_idx`(`toStoreId`, `status`),
    INDEX `StoreTransfer_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `StoreTransferLine` (
    `id` VARCHAR(191) NOT NULL,
    `transferId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
    `productName` VARCHAR(191) NOT NULL,
    `qty` INTEGER NOT NULL,

    INDEX `StoreTransferLine_transferId_idx`(`transferId`),
    INDEX `StoreTransferLine_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SpgSaleLine` ADD COLUMN `returnedQty` INTEGER NOT NULL DEFAULT 0;

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

ALTER TABLE `StoreReturn` ADD COLUMN `reportedBySpg` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `StoreReturnItem` ADD COLUMN `variantSku` VARCHAR(191) NOT NULL DEFAULT '';
ALTER TABLE `StoreReturnItem` ADD COLUMN `condition` ENUM('LAYAK', 'RUSAK', 'EXPIRED') NOT NULL DEFAULT 'LAYAK';
ALTER TABLE `WarehouseReturnItem` ADD COLUMN `variantSku` VARCHAR(191) NOT NULL DEFAULT '';
