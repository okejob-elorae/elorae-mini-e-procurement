-- Palet berkain (MariaDB). Setara 12_palet_kain di sisi Postgres.
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.
ALTER TABLE `ColorPalette` ADD COLUMN `fabricHex` VARCHAR(191) NULL,
    ADD COLUMN `portions` JSON NULL;
