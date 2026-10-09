-- Warna jenis pemasok dari katalog Pantone TCX (2026-10-09). Kembaran MariaDB dari Postgres 45_warna_pantone.
ALTER TABLE `SupplierType` ADD COLUMN `colorTcx` VARCHAR(191) NULL;
CREATE INDEX `SupplierType_colorTcx_idx` ON `SupplierType`(`colorTcx`);
