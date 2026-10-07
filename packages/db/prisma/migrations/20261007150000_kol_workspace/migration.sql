-- Ruang KOL (MariaDB). Setara 37_ruang_kol di sisi Postgres; alasan dan
-- aturan migrasi datanya ditulis di sana.
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.
-- DDL MariaDB tidak transaksional: berkas yang gagal di tengah jalan tetap
-- setengah terpasang. Migrasi data berjalan sesudah semua tabel dan kolom baru
-- ada, dan kolom lama baru dibuang paling akhir.

-- AlterTable
ALTER TABLE `Item` ADD COLUMN `kgPerRoll` DECIMAL(10, 2) NULL;

-- AlterTable
ALTER TABLE `Kol` ADD COLUMN `address` TEXT NULL,
    ADD COLUMN `avgViews` INTEGER NULL,
    ADD COLUMN `blockReason` TEXT NULL,
    ADD COLUMN `blockedAt` DATETIME(3) NULL,
    ADD COLUMN `engagementRate` DECIMAL(6, 2) NULL,
    ADD COLUMN `label` TEXT NULL,
    ADD COLUMN `lastContactAt` DATETIME(3) NULL,
    ADD COLUMN `postalCode` VARCHAR(191) NULL,
    ADD COLUMN `province` VARCHAR(191) NULL,
    ADD COLUMN `recipientName` VARCHAR(191) NULL,
    ADD COLUMN `sizeProfile` TEXT NULL,
    ADD COLUMN `waNormal` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `KolAccount` ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    MODIFY `platform` ENUM('INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'LAINNYA', 'SHOPEE') NOT NULL;

-- AlterTable
ALTER TABLE `KolBrief` ADD COLUMN `boostCost` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `campaignId` VARCHAR(191) NULL,
    ADD COLUMN `commissionPct` DECIMAL(5, 2) NULL,
    ADD COLUMN `dealAt` DATETIME(3) NULL,
    ADD COLUMN `jenis` ENUM('BARTER', 'BAYAR', 'CAMPURAN', 'KOMISI') NOT NULL DEFAULT 'BARTER',
    ADD COLUMN `lastContactAt` DATETIME(3) NULL,
    ADD COLUMN `outreachAt` DATETIME(3) NULL,
    ADD COLUMN `paidAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `paidAt` DATETIME(3) NULL,
    ADD COLUMN `payNote` TEXT NULL,
    ADD COLUMN `payStatus` ENUM('TIDAK_PERLU', 'BELUM', 'SEBAGIAN', 'LUNAS') NOT NULL DEFAULT 'TIDAK_PERLU',
    ADD COLUMN `picId` VARCHAR(191) NULL,
    ADD COLUMN `plannedLiveAt` DATETIME(3) NULL,
    ADD COLUMN `rating` INTEGER NULL,
    ADD COLUMN `tahap` ENUM('PROSPEK', 'DIHUBUNGI', 'NEGO', 'DEAL', 'BRIEF_DIKIRIM', 'SAMPEL_DIKIRIM', 'SAMPEL_DITERIMA', 'DRAF', 'DRAF_DISETUJUI', 'TAYANG', 'ANGKA_MASUK', 'DIBAYAR', 'SELESAI', 'DITOLAK', 'GHOSTING', 'BATAL') NOT NULL DEFAULT 'PROSPEK',
    ADD COLUMN `tahapAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `KolBriefDeliverable` MODIFY `platform` ENUM('INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'LAINNYA', 'SHOPEE') NOT NULL;

-- AlterTable
ALTER TABLE `ContentPlan` MODIFY `platform` ENUM('INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'LAINNYA', 'SHOPEE') NOT NULL;

-- CreateTable
CREATE TABLE `KolFollowerSnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `followers` INTEGER NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `source` VARCHAR(191) NULL,

    INDEX `KolFollowerSnapshot_accountId_idx`(`accountId`),
    INDEX `KolFollowerSnapshot_recordedAt_idx`(`recordedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolCampaign` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `brand` VARCHAR(191) NULL,
    `product` VARCHAR(191) NULL,
    `objective` TEXT NULL,
    `startDate` DATETIME(3) NULL,
    `endDate` DATETIME(3) NULL,
    `budget` DECIMAL(15, 2) NULL,
    `targetKol` INTEGER NULL,
    `targetContent` INTEGER NULL,
    `brief` TEXT NULL,
    `note` TEXT NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `KolCampaign_archivedAt_idx`(`archivedAt`),
    INDEX `KolCampaign_name_idx`(`name`),
    INDEX `KolCampaign_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolShipment` (
    `id` VARCHAR(191) NOT NULL,
    `collabId` VARCHAR(191) NOT NULL,
    `courier` VARCHAR(191) NULL,
    `trackingNo` VARCHAR(191) NULL,
    `sentAt` DATETIME(3) NULL,
    `receivedAt` DATETIME(3) NULL,
    `shippingCost` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `stockIssuedAt` DATETIME(3) NULL,
    `note` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `KolShipment_collabId_idx`(`collabId`),
    INDEX `KolShipment_trackingNo_idx`(`trackingNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolShipmentLine` (
    `id` VARCHAR(191) NOT NULL,
    `shipmentId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `itemName` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NULL,
    `qty` INTEGER NOT NULL,
    `unitCost` DECIMAL(15, 2) NOT NULL DEFAULT 0,

    INDEX `KolShipmentLine_shipmentId_idx`(`shipmentId`),
    INDEX `KolShipmentLine_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolContent` (
    `id` VARCHAR(191) NOT NULL,
    `collabId` VARCHAR(191) NOT NULL,
    `platform` ENUM('INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'LAINNYA', 'SHOPEE') NOT NULL,
    `format` ENUM('FEED', 'REELS', 'STORY', 'VIDEO', 'LIVE', 'CAROUSEL') NOT NULL,
    `link` TEXT NULL,
    `liveAt` DATETIME(3) NULL,
    `plannedAt` DATETIME(3) NULL,
    `draftLink` TEXT NULL,
    `draftStatus` ENUM('MENUNGGU', 'REVISI', 'DISETUJUI') NULL,
    `draftNote` TEXT NULL,
    `draftAt` DATETIME(3) NULL,
    `approvedById` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `adCode` VARCHAR(191) NULL,
    `adCodeUntil` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `KolContent_collabId_idx`(`collabId`),
    INDEX `KolContent_liveAt_idx`(`liveAt`),
    INDEX `KolContent_plannedAt_idx`(`plannedAt`),
    INDEX `KolContent_approvedById_idx`(`approvedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolContentMetric` (
    `id` VARCHAR(191) NOT NULL,
    `contentId` VARCHAR(191) NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `views` INTEGER NOT NULL DEFAULT 0,
    `likes` INTEGER NOT NULL DEFAULT 0,
    `comments` INTEGER NOT NULL DEFAULT 0,
    `shares` INTEGER NOT NULL DEFAULT 0,
    `saves` INTEGER NOT NULL DEFAULT 0,
    `source` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `createdById` VARCHAR(191) NULL,

    INDEX `KolContentMetric_contentId_idx`(`contentId`),
    INDEX `KolContentMetric_recordedAt_idx`(`recordedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolSale` (
    `id` VARCHAR(191) NOT NULL,
    `collabId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `orders` INTEGER NOT NULL DEFAULT 0,
    `gmv` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `commission` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `source` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `KolSale_collabId_idx`(`collabId`),
    INDEX `KolSale_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolNote` (
    `id` VARCHAR(191) NOT NULL,
    `kolId` VARCHAR(191) NULL,
    `collabId` VARCHAR(191) NULL,
    `body` TEXT NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `KolNote_kolId_idx`(`kolId`),
    INDEX `KolNote_collabId_idx`(`collabId`),
    INDEX `KolNote_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KolAgenda` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `time` VARCHAR(191) NULL,
    `kind` ENUM('TUGAS', 'MEETING', 'DEADLINE', 'KIRIM', 'KONTEN', 'BAYAR', 'LAINNYA') NOT NULL DEFAULT 'TUGAS',
    `checklist` TEXT NULL,
    `note` TEXT NULL,
    `campaignId` VARCHAR(191) NULL,
    `kolId` VARCHAR(191) NULL,
    `collabId` VARCHAR(191) NULL,
    `remindDaysBefore` INTEGER NOT NULL DEFAULT 0,
    `doneAt` DATETIME(3) NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `KolAgenda_date_idx`(`date`),
    INDEX `KolAgenda_ownerId_idx`(`ownerId`),
    INDEX `KolAgenda_campaignId_idx`(`campaignId`),
    INDEX `KolAgenda_kolId_idx`(`kolId`),
    INDEX `KolAgenda_collabId_idx`(`collabId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Kol_waNormal_idx` ON `Kol`(`waNormal`);

-- CreateIndex
CREATE INDEX `KolBrief_tahap_idx` ON `KolBrief`(`tahap`);

-- CreateIndex
CREATE INDEX `KolBrief_campaignId_idx` ON `KolBrief`(`campaignId`);

-- CreateIndex
CREATE INDEX `KolBrief_picId_idx` ON `KolBrief`(`picId`);

-- ─────────────────────────── Migrasi data ───────────────────────────

-- Status lama -> tahap.
UPDATE `KolBrief` SET
    `tahap` = CASE `status`
        WHEN 'DRAFT' THEN 'DEAL'
        WHEN 'DIKIRIM' THEN 'SAMPEL_DIKIRIM'
        WHEN 'DISETUJUI' THEN 'DRAF_DISETUJUI'
        WHEN 'KONTEN_DITERIMA' THEN 'DRAF'
        WHEN 'TAYANG' THEN 'TAYANG'
        WHEN 'SELESAI' THEN 'SELESAI'
        WHEN 'BATAL' THEN 'BATAL'
        ELSE 'PROSPEK'
    END,
    `tahapAt` = `updatedAt`,
    `dealAt` = `createdAt`,
    `payStatus` = CASE WHEN `fee` > 0 THEN 'BELUM' ELSE 'TIDAK_PERLU' END;

-- Teks campaign unik -> KolCampaign. Kolasi utf8mb4_unicode_ci mengelompokkan
-- "Lebaran" dan "lebaran" jadi satu; tautan lewat nama ikut kolasi yang sama.
INSERT INTO `KolCampaign` (`id`, `name`, `startDate`, `endDate`, `createdById`, `createdAt`, `updatedAt`)
SELECT
    CONCAT('kcm', SUBSTRING(MD5(MIN(TRIM(`campaign`))), 1, 22)),
    MIN(TRIM(`campaign`)),
    MIN(`startDate`),
    MAX(`dueDate`),
    MIN(`createdById`),
    MIN(`createdAt`),
    CURRENT_TIMESTAMP(3)
FROM `KolBrief`
WHERE TRIM(`campaign`) <> ''
GROUP BY TRIM(`campaign`);

UPDATE `KolBrief` AS b
JOIN `KolCampaign` AS c ON c.`name` = TRIM(b.`campaign`)
SET b.`campaignId` = c.`id`;

-- Brief lama yang barangnya sudah berangkat -> satu pengiriman tercatat.
-- Stok TIDAK digerakkan lagi: StockAdjustment KOL_SEEDING-nya sudah ada.
INSERT INTO `KolShipment` (`id`, `collabId`, `sentAt`, `stockIssuedAt`, `note`, `createdById`, `createdAt`, `updatedAt`)
SELECT
    CONCAT('ksm', SUBSTRING(MD5(`id`), 1, 22)),
    `id`,
    `stockIssuedAt`,
    `stockIssuedAt`,
    'dipindahkan dari brief lama',
    `createdById`,
    `stockIssuedAt`,
    `stockIssuedAt`
FROM `KolBrief`
WHERE `stockIssuedAt` IS NOT NULL;

INSERT INTO `KolShipmentLine` (`id`, `shipmentId`, `itemId`, `itemName`, `variantSku`, `qty`, `unitCost`)
SELECT
    CONCAT('ksl', SUBSTRING(MD5(i.`id`), 1, 22)),
    CONCAT('ksm', SUBSTRING(MD5(b.`id`), 1, 22)),
    i.`itemId`,
    i.`itemName`,
    i.`variantSku`,
    i.`qty`,
    0
FROM `KolBriefItem` AS i
JOIN `KolBrief` AS b ON b.`id` = i.`briefId`
WHERE b.`stockIssuedAt` IS NOT NULL;

-- ───────────────────── Buang kolom lama ─────────────────────

-- DropIndex
DROP INDEX `KolBrief_status_idx` ON `KolBrief`;

-- AlterTable
ALTER TABLE `KolBrief` DROP COLUMN `campaign`,
    DROP COLUMN `status`;
