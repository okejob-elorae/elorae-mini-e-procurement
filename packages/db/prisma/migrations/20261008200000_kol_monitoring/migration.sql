-- Pantau KOL lewat ekstensi Chrome — uji coba TikTok (MariaDB). Setara
-- 42_pantau_kol di sisi Postgres; isi dan alasannya ditulis di sana.
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.
-- DDL MariaDB tidak transaksional: berkas yang gagal di tengah jalan tetap
-- setengah terpasang.

-- AlterTable
ALTER TABLE `KolAccount` ADD COLUMN `er` DECIMAL(6, 2) NULL,
    ADD COLUMN `avgViews` INTEGER NULL,
    ADD COLUMN `erUpdatedAt` DATETIME(3) NULL,
    ADD COLUMN `platformUserId` VARCHAR(191) NULL,
    ADD COLUMN `lastCheckedAt` DATETIME(3) NULL,
    ADD COLUMN `checkStatus` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `KolFollowerSnapshot` ADD COLUMN `er` DECIMAL(6, 2) NULL,
    ADD COLUMN `avgViews` INTEGER NULL,
    ADD COLUMN `postsCounted` INTEGER NULL,
    ADD COLUMN `perangkatId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `KolContentMetric` ADD COLUMN `perangkatId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `KolPerangkat` (
    `id` VARCHAR(191) NOT NULL,
    `nama` VARCHAR(191) NOT NULL,
    `dibuatOlehId` VARCHAR(191) NOT NULL,
    `kodeHash` VARCHAR(191) NULL,
    `kodeBerlakuSampai` DATETIME(3) NULL,
    `tokenHash` VARCHAR(191) NULL,
    `tersambungAt` DATETIME(3) NULL,
    `terakhirLaporAt` DATETIME(3) NULL,
    `dicabutAt` DATETIME(3) NULL,
    `dijedaSampai` DATETIME(3) NULL,
    `alasanJeda` TEXT NULL,
    `versiEkstensi` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `KolPerangkat_kodeHash_key`(`kodeHash`),
    UNIQUE INDEX `KolPerangkat_tokenHash_key`(`tokenHash`),
    INDEX `KolPerangkat_dibuatOlehId_idx`(`dibuatOlehId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolTugasPantau` (
    `id` VARCHAR(191) NOT NULL,
    `jenis` VARCHAR(191) NOT NULL,
    `platform` ENUM('INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'LAINNYA', 'SHOPEE') NOT NULL,
    `accountId` VARCHAR(191) NULL,
    `contentId` VARCHAR(191) NULL,
    `url` TEXT NOT NULL,
    `titikH` INTEGER NULL,
    `prioritas` INTEGER NOT NULL DEFAULT 0,
    `jatuhAt` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ANTRE',
    `perangkatId` VARCHAR(191) NULL,
    `pinjamSampai` DATETIME(3) NULL,
    `percobaan` INTEGER NOT NULL DEFAULT 0,
    `galatTerakhir` TEXT NULL,
    `selesaiAt` DATETIME(3) NULL,
    `kunci` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `KolTugasPantau_kunci_key`(`kunci`),
    INDEX `KolTugasPantau_status_jatuhAt_idx`(`status`, `jatuhAt`),
    INDEX `KolTugasPantau_perangkatId_idx`(`perangkatId`),
    INDEX `KolTugasPantau_accountId_idx`(`accountId`),
    INDEX `KolTugasPantau_contentId_idx`(`contentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolLogPantau` (
    `id` VARCHAR(191) NOT NULL,
    `perangkatId` VARCHAR(191) NULL,
    `tugasId` VARCHAR(191) NULL,
    `jenis` VARCHAR(191) NOT NULL,
    `kode` VARCHAR(191) NULL,
    `pesan` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `KolLogPantau_createdAt_idx`(`createdAt`),
    INDEX `KolLogPantau_perangkatId_idx`(`perangkatId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
