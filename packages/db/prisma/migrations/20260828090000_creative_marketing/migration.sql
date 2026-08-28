-- Modul creative marketing pada MariaDB. Setara 9_creative_marketing di sisi Postgres.
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.

-- CreateTable
CREATE TABLE `Kol` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `niche` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `rateCard` DECIMAL(15, 2) NULL,
    `rateNote` TEXT NULL,
    `note` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Kol_isActive_name_idx`(`isActive`, `name`),
    INDEX `Kol_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolAccount` (
    `id` VARCHAR(191) NOT NULL,
    `kolId` VARCHAR(191) NOT NULL,
    `platform` ENUM('INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'LAINNYA') NOT NULL,
    `handle` VARCHAR(191) NOT NULL,
    `followers` INTEGER NOT NULL DEFAULT 0,
    `url` VARCHAR(191) NULL,

    INDEX `KolAccount_kolId_idx`(`kolId`),
    UNIQUE INDEX `KolAccount_kolId_platform_handle_key`(`kolId`, `platform`, `handle`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolBrief` (
    `id` VARCHAR(191) NOT NULL,
    `docNo` VARCHAR(191) NOT NULL,
    `kolId` VARCHAR(191) NOT NULL,
    `campaign` VARCHAR(191) NOT NULL,
    `status` ENUM('DRAFT', 'DIKIRIM', 'DISETUJUI', 'KONTEN_DITERIMA', 'TAYANG', 'SELESAI', 'BATAL') NOT NULL DEFAULT 'DRAFT',
    `fee` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `briefText` TEXT NULL,
    `doList` TEXT NULL,
    `dontList` TEXT NULL,
    `startDate` DATETIME(3) NULL,
    `dueDate` DATETIME(3) NULL,
    `sentAt` DATETIME(3) NULL,
    `liveAt` DATETIME(3) NULL,
    `stockIssuedAt` DATETIME(3) NULL,
    `cancelReason` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `KolBrief_docNo_key`(`docNo`),
    INDEX `KolBrief_kolId_idx`(`kolId`),
    INDEX `KolBrief_status_idx`(`status`),
    INDEX `KolBrief_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolBriefDeliverable` (
    `id` VARCHAR(191) NOT NULL,
    `briefId` VARCHAR(191) NOT NULL,
    `platform` ENUM('INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'LAINNYA') NOT NULL,
    `format` ENUM('FEED', 'REELS', 'STORY', 'VIDEO', 'LIVE', 'CAROUSEL') NOT NULL,
    `qty` INTEGER NOT NULL DEFAULT 1,
    `dueDate` DATETIME(3) NULL,

    INDEX `KolBriefDeliverable_briefId_idx`(`briefId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolBriefItem` (
    `id` VARCHAR(191) NOT NULL,
    `briefId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `itemName` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NULL,
    `qty` INTEGER NOT NULL DEFAULT 1,

    INDEX `KolBriefItem_briefId_idx`(`briefId`),
    INDEX `KolBriefItem_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContentPlan` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `platform` ENUM('INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'LAINNYA') NOT NULL,
    `format` ENUM('FEED', 'REELS', 'STORY', 'VIDEO', 'LIVE', 'CAROUSEL') NOT NULL,
    `status` ENUM('IDE', 'DRAFT', 'REVIEW', 'DIJADWALKAN', 'TAYANG', 'BATAL') NOT NULL DEFAULT 'IDE',
    `scheduledAt` DATETIME(3) NULL,
    `publishedAt` DATETIME(3) NULL,
    `postUrl` VARCHAR(191) NULL,
    `caption` TEXT NULL,
    `note` TEXT NULL,
    `itemId` VARCHAR(191) NULL,
    `assigneeId` VARCHAR(191) NULL,
    `briefId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ContentPlan_status_scheduledAt_idx`(`status`, `scheduledAt`),
    INDEX `ContentPlan_briefId_idx`(`briefId`),
    INDEX `ContentPlan_itemId_idx`(`itemId`),
    INDEX `ContentPlan_assigneeId_idx`(`assigneeId`),
    INDEX `ContentPlan_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

