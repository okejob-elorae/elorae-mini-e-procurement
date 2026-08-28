-- Huruf pilihan tiap pengguna (MariaDB). Setara 10_huruf_tema di sisi Postgres.
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.
ALTER TABLE `User` ADD COLUMN `themeFontId` VARCHAR(191) NULL;
