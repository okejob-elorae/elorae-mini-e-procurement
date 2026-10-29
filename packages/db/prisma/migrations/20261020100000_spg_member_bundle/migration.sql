-- SPG: promo paket, member, rincian potongan per promo (2026-10-20).
-- Rancangan: docs/superpowers/specs/2026-10-20-spg-promo-member-pelanggan-design.md
-- Kembaran MariaDB dari Postgres 47_spg_member_paket. Tanpa foreign key (relationMode = prisma).

ALTER TABLE `CounterPromo` ADD COLUMN `memberOnly` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `CounterPromoTarget` ADD COLUMN `qty` INTEGER NULL;

ALTER TABLE `SpgSale` ADD COLUMN `memberId` VARCHAR(191) NULL,
    ADD COLUMN `memberTier` VARCHAR(191) NULL,
    ADD COLUMN `memberDiscount` DECIMAL(15, 2) NOT NULL DEFAULT 0;
CREATE INDEX `SpgSale_memberId_idx` ON `SpgSale`(`memberId`);

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
