-- SKB pemasok + PPN tagihan konsinyasi per toko (MariaDB). Setara
-- 41_skb_ppn_konsi di sisi Postgres; isi dan alasannya ditulis di sana.
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.
-- DDL MariaDB tidak transaksional: berkas yang gagal di tengah jalan tetap
-- setengah terpasang.

-- AlterTable
ALTER TABLE `Supplier` ADD COLUMN `skbNumber` VARCHAR(191) NULL,
    ADD COLUMN `skbValidUntil` DATETIME(3) NULL,
    ADD COLUMN `skbPhotoUrl` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Store` ADD COLUMN `consignmentVat` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `ConsignmentCycle` ADD COLUMN `vatApplied` BOOLEAN NULL;

-- Siklus yang sudah dikunci mempertahankan perilaku lama (tagihan termasuk PPN).
UPDATE `ConsignmentCycle` SET `vatApplied` = true WHERE `lockedAt` IS NOT NULL AND `vatApplied` IS NULL;
