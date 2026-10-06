-- Varian pada baris kiriman titipan konsinyasi (MariaDB).
-- Setara 31_kiriman_konsi_varian di sisi Postgres; alasannya ditulis di sana.
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.
ALTER TABLE `ConsignmentShipmentItem` ADD COLUMN `variantSku` VARCHAR(191) NULL;
