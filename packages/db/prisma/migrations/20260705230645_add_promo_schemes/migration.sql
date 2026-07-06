-- AlterTable
ALTER TABLE `FieldSalesOrder` ADD COLUMN `appliedOrderPromoId` VARCHAR(191) NULL,
    ADD COLUMN `orderDiscountAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `FieldSalesOrderLine` ADD COLUMN `appliedPromoId` VARCHAR(191) NULL,
    ADD COLUMN `discountAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `Promo` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('PERCENT', 'FIXED', 'TIERED') NOT NULL,
    `level` ENUM('LINE', 'ORDER') NOT NULL,
    `termsType` ENUM('PUTUS', 'KONSI') NOT NULL DEFAULT 'PUTUS',
    `value` DECIMAL(15, 2) NULL,
    `minQty` INTEGER NULL,
    `minOrderSubtotal` DECIMAL(15, 2) NULL,
    `minOrderQty` INTEGER NULL,
    `allStores` BOOLEAN NOT NULL DEFAULT true,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Promo_isActive_level_idx`(`isActive`, `level`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PromoItem` (
    `id` VARCHAR(191) NOT NULL,
    `promoId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,

    INDEX `PromoItem_itemId_idx`(`itemId`),
    UNIQUE INDEX `PromoItem_promoId_itemId_key`(`promoId`, `itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PromoStore` (
    `id` VARCHAR(191) NOT NULL,
    `promoId` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,

    INDEX `PromoStore_storeId_idx`(`storeId`),
    UNIQUE INDEX `PromoStore_promoId_storeId_key`(`promoId`, `storeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PromoTier` (
    `id` VARCHAR(191) NOT NULL,
    `promoId` VARCHAR(191) NOT NULL,
    `minQty` INTEGER NOT NULL,
    `unitPrice` DECIMAL(15, 2) NOT NULL,

    UNIQUE INDEX `PromoTier_promoId_minQty_key`(`promoId`, `minQty`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

