-- Sell more, stage 3. Rationale: packages/db/prisma/postgres/migrations/18_jual_lebih.
ALTER TABLE `Promo` MODIFY `type` ENUM('PERCENT', 'FIXED', 'TIERED', 'BONUS') NOT NULL,
    ADD COLUMN `bonusBuyQty` INTEGER NULL,
    ADD COLUMN `bonusFreeQty` INTEGER NULL,
    ADD COLUMN `bonusItemId` VARCHAR(191) NULL;
ALTER TABLE `FieldSalesOrderLine` ADD COLUMN `isBonus` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `bonusPromoId` VARCHAR(191) NULL;
ALTER TABLE `Store` ADD COLUMN `storeClass` VARCHAR(191) NULL;

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

    UNIQUE INDEX `StoreStockTarget_storeId_itemId_variantSku_key`(`storeId`, `itemId`, `variantSku`),
    INDEX `StoreStockTarget_storeId_idx`(`storeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
