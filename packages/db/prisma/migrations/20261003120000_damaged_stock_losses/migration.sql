-- Bagian toko pada promo konter, gudang barang rusak, barang hilang (MariaDB).
-- Setara 26_rusak_hilang di sisi Postgres; alasannya ditulis di sana.
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.

ALTER TABLE `CounterPromo` ADD COLUMN `storeSharePercent` DECIMAL(5, 2) NOT NULL DEFAULT 0;
ALTER TABLE `SpgSaleLine` ADD COLUMN `storeDiscount` DECIMAL(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE `StoreReturnItem` ADD COLUMN `spgSaleReturnLineId` VARCHAR(191) NULL;

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

CREATE TABLE `StockLossShare` (
    `id` VARCHAR(191) NOT NULL,
    `lossId` VARCHAR(191) NOT NULL,
    `bearer` VARCHAR(191) NOT NULL,
    `bearerUserId` VARCHAR(191) NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `settledAt` DATETIME(3) NULL,
    `settledById` VARCHAR(191) NULL,
    `settleNote` TEXT NULL,

    INDEX `StockLossShare_lossId_idx`(`lossId`),
    INDEX `StockLossShare_bearerUserId_settledAt_idx`(`bearerUserId`, `settledAt`),
    INDEX `StockLossShare_bearer_settledAt_idx`(`bearer`, `settledAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ConsignmentCycle` ADD COLUMN `promoBorneByElorae` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `lossChargedToStore` DECIMAL(15, 2) NOT NULL DEFAULT 0;
