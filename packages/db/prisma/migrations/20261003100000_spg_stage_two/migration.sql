-- SPG tahap 2 (MariaDB). Setara 25_spg_lanjutan di sisi Postgres; alasannya ditulis di sana.
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.

ALTER TABLE `Item` ADD COLUMN `material` VARCHAR(191) NULL,
    ADD COLUMN `careInstructions` TEXT NULL,
    ADD COLUMN `sizeChartId` VARCHAR(191) NULL;

ALTER TABLE `SpgSale` ADD COLUMN `discountTotal` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `orderPromoId` VARCHAR(191) NULL,
    ADD COLUMN `orderPromoName` VARCHAR(191) NULL,
    ADD COLUMN `orderDiscount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `manualDiscount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `manualDiscountReason` TEXT NULL,
    ADD COLUMN `customerId` VARCHAR(191) NULL,
    ADD COLUMN `visitId` VARCHAR(191) NULL,
    ADD COLUMN `capturedOffline` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `syncedAt` DATETIME(3) NULL;
CREATE INDEX `SpgSale_customerId_idx` ON `SpgSale`(`customerId`);

ALTER TABLE `SpgSaleLine` ADD COLUMN `discount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `counterPromoId` VARCHAR(191) NULL,
    ADD COLUMN `promoName` VARCHAR(191) NULL;

ALTER TABLE `StoreReceiptLine` ADD COLUMN `qtyDamaged` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `damageNote` VARCHAR(191) NULL,
    ADD COLUMN `damagePhotoUrl` VARCHAR(191) NULL,
    ADD COLUMN `damageStatus` VARCHAR(191) NULL,
    ADD COLUMN `damageDecidedById` VARCHAR(191) NULL,
    ADD COLUMN `damageDecidedAt` DATETIME(3) NULL,
    ADD COLUMN `damageDecisionNote` TEXT NULL;

ALTER TABLE `StoreReturnItem` ADD COLUMN `storeReceiptLineId` VARCHAR(191) NULL;

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
    `note` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CounterPromo_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CounterPromoTarget` (
    `id` VARCHAR(191) NOT NULL,
    `promoId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `refId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `CounterPromoTarget_promoId_kind_refId_key`(`promoId`, `kind`, `refId`),
    INDEX `CounterPromoTarget_kind_refId_idx`(`kind`, `refId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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

    UNIQUE INDEX `StoreCustomer_storeId_phone_key`(`storeId`, `phone`),
    INDEX `StoreCustomer_storeId_name_idx`(`storeId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CustomerRequest` (
    `id` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
    `description` VARCHAR(191) NOT NULL,
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

    UNIQUE INDEX `SpgDailyClose_storeId_day_key`(`storeId`, `day`),
    INDEX `SpgDailyClose_day_idx`(`day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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

    UNIQUE INDEX `SpgShift_userId_day_key`(`userId`, `day`),
    INDEX `SpgShift_storeId_day_idx`(`storeId`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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

CREATE TABLE `SpgCommission` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `period` VARCHAR(191) NOT NULL,
    `unitsSold` INTEGER NOT NULL,
    `commission` DECIMAL(15, 2) NOT NULL,
    `basis` VARCHAR(191) NOT NULL,
    `lockedById` VARCHAR(191) NOT NULL,
    `lockedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `paidAt` DATETIME(3) NULL,
    `paidById` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SpgCommission_userId_storeId_period_key`(`userId`, `storeId`, `period`),
    INDEX `SpgCommission_period_idx`(`period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
