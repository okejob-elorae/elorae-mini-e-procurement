-- Pembayaran KOL per termin + PPh + gross-up + data pajak terenkripsi (MariaDB).
-- Setara 38_kol_pembayaran_pajak di sisi Postgres; alasan dan aturan isi
-- awalnya ditulis di sana.
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.
-- DDL MariaDB tidak transaksional: berkas yang gagal di tengah jalan tetap
-- setengah terpasang. Isi awal berjalan sesudah tabel dan kolom baru ada.

-- AlterTable
ALTER TABLE `Kol` ADD COLUMN `jenisPajak` ENUM('ORANG_PRIBADI', 'BADAN', 'TIDAK_DIPOTONG') NOT NULL DEFAULT 'ORANG_PRIBADI',
    ADD COLUMN `alasanTidakDipotong` TEXT NULL,
    ADD COLUMN `adaNpwp` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `grossUpBawaan` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `bankNameEnc` TEXT NULL,
    ADD COLUMN `bankAccountEnc` TEXT NULL,
    ADD COLUMN `bankHolderEnc` TEXT NULL,
    ADD COLUMN `nikEnc` TEXT NULL,
    ADD COLUMN `npwpEnc` TEXT NULL,
    ADD COLUMN `bankLast4` VARCHAR(191) NULL,
    ADD COLUMN `nikLast4` VARCHAR(191) NULL,
    ADD COLUMN `dataPajakLengkap` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `KolBrief` ADD COLUMN `modePajak` ENUM('DIPOTONG', 'GROSS_UP') NOT NULL DEFAULT 'DIPOTONG',
    ADD COLUMN `jurnalOtomatis` BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE `KolPaymentTerm` (
    `id` VARCHAR(191) NOT NULL,
    `collabId` VARCHAR(191) NOT NULL,
    `urutan` INTEGER NOT NULL DEFAULT 1,
    `label` VARCHAR(191) NOT NULL,
    `persen` DECIMAL(5, 2) NULL,
    `neto` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `bruto` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `pph` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `dpp` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `jenisPajak` ENUM('ORANG_PRIBADI', 'BADAN', 'TIDAK_DIPOTONG') NOT NULL DEFAULT 'ORANG_PRIBADI',
    `grossUp` BOOLEAN NOT NULL DEFAULT false,
    `tarifInfo` TEXT NULL,
    `pemicu` ENUM('DEAL', 'TAYANG', 'TANGGAL') NOT NULL DEFAULT 'TAYANG',
    `hariSesudah` INTEGER NOT NULL DEFAULT 0,
    `jatuhTempo` DATETIME(3) NULL,
    `status` ENUM('BELUM', 'DIBAYAR', 'BATAL') NOT NULL DEFAULT 'BELUM',
    `bayarKe` INTEGER NOT NULL DEFAULT 0,
    `dibayarAt` DATETIME(3) NULL,
    `dibayarOlehId` VARCHAR(191) NULL,
    `buktiTransferUrl` VARCHAR(191) NULL,
    `nomorBuktiPotong` VARCHAR(191) NULL,
    `buktiPotongAt` DATETIME(3) NULL,
    `setorAt` DATETIME(3) NULL,
    `ntpn` VARCHAR(191) NULL,
    `catatan` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `KolPaymentTerm_collabId_idx`(`collabId`),
    INDEX `KolPaymentTerm_status_idx`(`status`),
    INDEX `KolPaymentTerm_dibayarAt_idx`(`dibayarAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ───────────────────── Isi awal ─────────────────────

UPDATE `KolBrief` SET `jurnalOtomatis` = false
WHERE `fee` > 0
  AND (`tahap` IN ('TAYANG', 'ANGKA_MASUK', 'DIBAYAR', 'SELESAI') OR `payStatus` IN ('SEBAGIAN', 'LUNAS'));

INSERT INTO `KolPaymentTerm` (`id`, `collabId`, `urutan`, `label`, `persen`, `neto`, `bruto`, `pemicu`, `hariSesudah`, `jatuhTempo`, `status`, `bayarKe`, `dibayarAt`, `catatan`, `createdAt`, `updatedAt`)
SELECT
    CONCAT('ktm', SUBSTRING(MD5(CONCAT(`id`, '-1')), 1, 22)),
    `id`,
    1,
    'Pelunasan',
    100,
    `fee`,
    `fee`,
    'TAYANG',
    14,
    CASE WHEN `liveAt` IS NULL THEN NULL ELSE DATE_ADD(`liveAt`, INTERVAL 14 DAY) END,
    'DIBAYAR',
    0,
    COALESCE(`paidAt`, `updatedAt`),
    'Dibayar sebelum modul pajak — PPh tidak dihitung.',
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
FROM `KolBrief`
WHERE `fee` > 0 AND `payStatus` = 'LUNAS';

INSERT INTO `KolPaymentTerm` (`id`, `collabId`, `urutan`, `label`, `persen`, `neto`, `bruto`, `pemicu`, `hariSesudah`, `jatuhTempo`, `status`, `bayarKe`, `dibayarAt`, `catatan`, `createdAt`, `updatedAt`)
SELECT
    CONCAT('ktm', SUBSTRING(MD5(CONCAT(`id`, '-1')), 1, 22)),
    `id`,
    1,
    'Dibayar sebelumnya',
    NULL,
    LEAST(`paidAmount`, `fee`),
    LEAST(`paidAmount`, `fee`),
    'DEAL',
    0,
    NULL,
    'DIBAYAR',
    0,
    COALESCE(`paidAt`, `updatedAt`),
    'Dibayar sebelum modul pajak — PPh tidak dihitung.',
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
FROM `KolBrief`
WHERE `fee` > 0 AND `payStatus` = 'SEBAGIAN' AND `paidAmount` > 0;

INSERT INTO `KolPaymentTerm` (`id`, `collabId`, `urutan`, `label`, `persen`, `neto`, `bruto`, `pemicu`, `hariSesudah`, `jatuhTempo`, `status`, `bayarKe`, `createdAt`, `updatedAt`)
SELECT
    CONCAT('ktm', SUBSTRING(MD5(CONCAT(`id`, '-2')), 1, 22)),
    `id`,
    2,
    'Pelunasan',
    NULL,
    `fee` - LEAST(`paidAmount`, `fee`),
    `fee` - LEAST(`paidAmount`, `fee`),
    'TAYANG',
    14,
    CASE WHEN `liveAt` IS NULL THEN NULL ELSE DATE_ADD(`liveAt`, INTERVAL 14 DAY) END,
    'BELUM',
    0,
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
FROM `KolBrief`
WHERE `fee` > 0 AND `payStatus` = 'SEBAGIAN' AND `paidAmount` > 0 AND `paidAmount` < `fee`;

INSERT INTO `KolPaymentTerm` (`id`, `collabId`, `urutan`, `label`, `persen`, `neto`, `bruto`, `pemicu`, `hariSesudah`, `jatuhTempo`, `status`, `bayarKe`, `createdAt`, `updatedAt`)
SELECT
    CONCAT('ktm', SUBSTRING(MD5(CONCAT(`id`, '-1')), 1, 22)),
    `id`,
    1,
    'Pelunasan',
    100,
    `fee`,
    `fee`,
    'TAYANG',
    14,
    CASE WHEN `liveAt` IS NULL THEN NULL ELSE DATE_ADD(`liveAt`, INTERVAL 14 DAY) END,
    'BELUM',
    0,
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
FROM `KolBrief`
WHERE `fee` > 0 AND (`payStatus` IN ('BELUM', 'TIDAK_PERLU') OR (`payStatus` = 'SEBAGIAN' AND `paidAmount` <= 0));

UPDATE `KolBrief` SET `payStatus` = 'BELUM'
WHERE `fee` > 0 AND `payStatus` = 'TIDAK_PERLU';
