-- Jenis gerakan buku stok toko `HILANG` (MariaDB). Setara 35_buku_toko_hilang
-- di sisi Postgres; alasannya ditulis di sana.
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.
ALTER TABLE `StoreStockMovement` MODIFY `kind` ENUM('TERIMA', 'JUAL', 'OPNAME', 'MUTASI_KELUAR', 'MUTASI_MASUK', 'RETUR_KELUAR', 'RETUR_PEMBELI', 'HILANG') NOT NULL;
