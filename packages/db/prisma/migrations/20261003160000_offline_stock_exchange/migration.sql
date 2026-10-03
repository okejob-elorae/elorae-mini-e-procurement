-- Pekerjaan SPG tanpa sinyal dan tukar barang di konter (MariaDB).
-- Setara 28_luring_tukar di sisi Postgres; alasannya ditulis di sana.
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.

-- Tukar barang di konter dicabut sebelum migrasi ini pernah dijalankan:
-- tidak ada kolom tukar (nama folder dibiarkan).
ALTER TABLE `StoreOpname` ADD COLUMN `idempotencyKey` VARCHAR(191) NULL;
ALTER TABLE `StoreReceipt` ADD COLUMN `idempotencyKey` VARCHAR(191) NULL;
ALTER TABLE `StoreVisit` ADD COLUMN `capturedOffline` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `clientId` VARCHAR(191) NULL,
    ADD COLUMN `syncedAt` DATETIME(3) NULL;
CREATE UNIQUE INDEX `StoreOpname_idempotencyKey_key` ON `StoreOpname`(`idempotencyKey`);
CREATE UNIQUE INDEX `StoreReceipt_idempotencyKey_key` ON `StoreReceipt`(`idempotencyKey`);
CREATE UNIQUE INDEX `StoreVisit_clientId_key` ON `StoreVisit`(`clientId`);
