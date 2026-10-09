-- Warna pilihan pemilik (2026-10-09). Kembaran MariaDB dari Postgres 44_warna_pilihan.
-- SupplierType.color: warna jenis pemasok (#rrggbb), NULL = otomatis.
-- User.chartColors: warna grafik beranda pribadi (JSON), NULL = ikut tema.
ALTER TABLE `SupplierType` ADD COLUMN `color` VARCHAR(191) NULL;
ALTER TABLE `User` ADD COLUMN `chartColors` TEXT NULL;
