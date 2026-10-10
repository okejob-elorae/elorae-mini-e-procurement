-- KOL Manager lengkap (2026-10-10). Rancangan: docs/superpowers/specs/2026-10-10-kol-manager-lengkap-design.md
-- Kembaran MariaDB dari Postgres 46_kol_manager_lengkap. Tanpa foreign key (relationMode = prisma).

ALTER TABLE `KolCampaign` ADD COLUMN `targetViews` INTEGER NULL,
    ADD COLUMN `status` ENUM('DRAFT', 'BERJALAN', 'SELESAI', 'BATAL') NOT NULL DEFAULT 'BERJALAN';
UPDATE `KolCampaign` SET `status` = 'SELESAI' WHERE `archivedAt` IS NOT NULL;
CREATE INDEX `KolCampaign_status_idx` ON `KolCampaign`(`status`);

ALTER TABLE `Kol` ADD COLUMN `rateFormat` TEXT NULL;

CREATE TABLE `KolBrandCollab` (
    `id` VARCHAR(191) NOT NULL,
    `kunci` VARCHAR(191) NOT NULL,
    `kolId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NULL,
    `platform` ENUM('INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'LAINNYA', 'SHOPEE') NOT NULL,
    `brandHandle` VARCHAR(191) NOT NULL,
    `brandName` VARCHAR(191) NULL,
    `jenis` ENUM('BERBAYAR', 'KOLABORASI', 'TAG') NOT NULL,
    `postId` VARCHAR(191) NULL,
    `postUrl` TEXT NULL,
    `postedAt` DATETIME(3) NULL,
    `caption` TEXT NULL,
    `views` INTEGER NULL,
    `sumber` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `KolBrandCollab_kunci_key`(`kunci`),
    INDEX `KolBrandCollab_kolId_postedAt_idx`(`kolId`, `postedAt`),
    INDEX `KolBrandCollab_brandHandle_idx`(`brandHandle`),
    INDEX `KolBrandCollab_accountId_idx`(`accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `KolCalendarFeed` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `KolCalendarFeed_tokenHash_key`(`tokenHash`),
    INDEX `KolCalendarFeed_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
