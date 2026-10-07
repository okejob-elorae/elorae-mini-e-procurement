-- Anti-dobel GRN / pengeluaran bahan / pembayaran toko konsinyasi, dan sidik
-- isi foto (MariaDB). Setara 34_kunci_kirim_hash_foto di sisi Postgres;
-- alasannya ditulis di sana.
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.
ALTER TABLE `GRN` ADD COLUMN `idempotencyKey` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `GRN_idempotencyKey_key` ON `GRN`(`idempotencyKey`);

ALTER TABLE `MaterialIssue` ADD COLUMN `idempotencyKey` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `MaterialIssue_idempotencyKey_key` ON `MaterialIssue`(`idempotencyKey`);

ALTER TABLE `ConsignmentPayment` ADD COLUMN `idempotencyKey` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `ConsignmentPayment_idempotencyKey_key` ON `ConsignmentPayment`(`idempotencyKey`);

-- Mengisi foto lama membaca seluruh isi tabel `Foto` sekali (LONGBLOB) —
-- hitung baris dan ukurannya dulu sebelum menjalankannya di produksi.
ALTER TABLE `Foto` ADD COLUMN `sha256` VARCHAR(191) NULL;
CREATE INDEX `Foto_sha256_idx` ON `Foto`(`sha256`);
UPDATE `Foto` SET `sha256` = SHA2(`bytes`, 256) WHERE `sha256` IS NULL;
