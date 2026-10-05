-- Kolom piutang yang sampai hari ini HANYA punya migrasi Postgres (MariaDB).
-- Setara 13_antrean_luring, bagian piutang dari 17_lapangan, dan
-- 22_pengganti_laporan di sisi Postgres; alasannya ditulis di sana.
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.
--
-- Tanpa migrasi ini `schema.prisma` memuat 14 kolom yang tidak pernah dibuat di
-- MariaDB, jadi setiap kueri ke PaymentClaim / StoreReturn / CollectionNote di
-- produksi gagal "Unknown column" — termasuk layar piutang yang tidak menyentuh
-- giro sama sekali, karena Prisma memilih semua kolom skalar.
--
-- Semua kolom baru NULL (atau NOT NULL ber-DEFAULT), jadi aman untuk tabel yang
-- sudah berisi data. Indeks unik di atas kolom yang seluruhnya NULL tidak bisa
-- bertabrakan: MariaDB membolehkan banyak NULL di indeks unik.
--
-- Bisa dijalankan ulang (ADD COLUMN / CREATE INDEX ... IF NOT EXISTS): migrasi
-- yang tercatat gagal memblokir deploy berikutnya sampai
-- `prisma migrate resolve --rolled-back 20261005140000_receivables_offline_giro_replacement`,
-- dan SQL idempoten yang membuat pemulihan itu aman. Tanpa FOREIGN KEY:
-- relasinya `relationMode = "prisma"`.

-- PaymentClaim: data giro (17_lapangan), kunci antrean luring (13_antrean_luring),
-- tautan laporan pengganti (22_pengganti_laporan).
ALTER TABLE `PaymentClaim`
    ADD COLUMN IF NOT EXISTS `giroNo` VARCHAR(191) NULL,
    ADD COLUMN IF NOT EXISTS `giroBank` VARCHAR(191) NULL,
    ADD COLUMN IF NOT EXISTS `giroIssueDate` DATETIME(3) NULL,
    ADD COLUMN IF NOT EXISTS `giroEffectiveDate` DATETIME(3) NULL,
    ADD COLUMN IF NOT EXISTS `giroStatus` VARCHAR(191) NULL,
    ADD COLUMN IF NOT EXISTS `giroSettledAt` DATETIME(3) NULL,
    ADD COLUMN IF NOT EXISTS `idempotencyKey` VARCHAR(191) NULL,
    ADD COLUMN IF NOT EXISTS `replacesClaimId` VARCHAR(191) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS `PaymentClaim_idempotencyKey_key` ON `PaymentClaim`(`idempotencyKey`);
CREATE UNIQUE INDEX IF NOT EXISTS `PaymentClaim_replacesClaimId_key` ON `PaymentClaim`(`replacesClaimId`);
-- Antrean giro menunggu cair menyaring giroStatus lalu mengurutkan giroEffectiveDate.
-- Postgres sudah punya indeks bernama sama (17_lapangan); kini juga ada di kedua skema.
CREATE INDEX IF NOT EXISTS `PaymentClaim_giroStatus_giroEffectiveDate_idx` ON `PaymentClaim`(`giroStatus`, `giroEffectiveDate`);

-- StoreReturn: kunci antrean luring dan tautan laporan pengganti.
ALTER TABLE `StoreReturn`
    ADD COLUMN IF NOT EXISTS `idempotencyKey` VARCHAR(191) NULL,
    ADD COLUMN IF NOT EXISTS `replacesReturnId` VARCHAR(191) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS `StoreReturn_idempotencyKey_key` ON `StoreReturn`(`idempotencyKey`);
CREATE UNIQUE INDEX IF NOT EXISTS `StoreReturn_replacesReturnId_key` ON `StoreReturn`(`replacesReturnId`);

-- CollectionNote: kontrabon yang dicatat salesman dari HP lalu dikonfirmasi kantor.
-- Baris lama semuanya dibuat kantor, maka DEFAULT 'OFFICE'.
ALTER TABLE `CollectionNote`
    ADD COLUMN IF NOT EXISTS `source` VARCHAR(191) NOT NULL DEFAULT 'OFFICE',
    ADD COLUMN IF NOT EXISTS `confirmedAt` DATETIME(3) NULL,
    ADD COLUMN IF NOT EXISTS `confirmedById` VARCHAR(191) NULL,
    ADD COLUMN IF NOT EXISTS `idempotencyKey` VARCHAR(191) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS `CollectionNote_idempotencyKey_key` ON `CollectionNote`(`idempotencyKey`);
