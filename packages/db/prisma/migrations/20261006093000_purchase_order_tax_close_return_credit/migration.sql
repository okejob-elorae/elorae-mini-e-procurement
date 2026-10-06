-- Pembelian: PPN PO, tutup PO kurang kirim, kredit retur pemasok (MariaDB).
-- Setara 33_pembelian_ppn_retur_tutup di sisi Postgres; alasannya ditulis di sana.
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.
ALTER TABLE `PurchaseOrder` ADD COLUMN `ppnRatePercent` DECIMAL(5,2) NULL;
ALTER TABLE `PurchaseOrder` ADD COLUMN `closedAt` DATETIME(3) NULL;
ALTER TABLE `PurchaseOrder` ADD COLUMN `closedById` VARCHAR(191) NULL;
ALTER TABLE `PurchaseOrder` ADD COLUMN `closeReason` TEXT NULL;

ALTER TABLE `VendorReturn` ADD COLUMN `poId` VARCHAR(191) NULL;
ALTER TABLE `VendorReturn` ADD COLUMN `poCreditAmount` DECIMAL(15,2) NULL;
CREATE INDEX `VendorReturn_poId_idx` ON `VendorReturn`(`poId`);
