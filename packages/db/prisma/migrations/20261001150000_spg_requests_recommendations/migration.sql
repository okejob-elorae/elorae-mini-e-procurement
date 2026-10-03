-- Permintaan SPG ke salesman dan rekomendasi salesman ke toko (MariaDB).
-- Setara 24_saran_rekomendasi di sisi Postgres; alasannya ditulis di sana.
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.

ALTER TABLE `StockRequest` ADD COLUMN `fieldSalesOrderId` VARCHAR(191) NULL;
CREATE INDEX `StockRequest_fieldSalesOrderId_idx` ON `StockRequest`(`fieldSalesOrderId`);
ALTER TABLE `StockRequestLine` ADD COLUMN `alasan` VARCHAR(191) NULL;

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
