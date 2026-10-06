-- Waktu hitung per baris opname toko (MariaDB).
-- Setara 32_opname_waktu_hitung di sisi Postgres; alasannya ditulis di sana.
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.
ALTER TABLE `StoreOpnameLine` ADD COLUMN `countedAt` DATETIME(3) NULL;
