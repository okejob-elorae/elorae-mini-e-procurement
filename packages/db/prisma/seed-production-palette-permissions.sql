-- Izin mengelola palet warna produksi (MariaDB, pola prod). Idempoten — aman dijalankan ulang.
-- Setara postgres/seed-production-palette-permissions.sql; alasannya ditulis di sana.
-- Jalankan di prod SESUDAH migrate:deploy (pipeline deploy tidak pernah men-seed).
--
-- Melihat halaman palet memakai `production_colors:view` yang sudah ada; menyimpan
-- palet dan daftar tinta dasar tim butuh izin baru ini. Tanpa barisnya, pengguna
-- produksi non-admin bisa membuka halaman tapi setiap simpan ditolak `TANPA_AKSES`.

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'production_colors:manage', 'production_colors', 'manage',
       'Save colour palettes and the team base inks used for print mix recipes'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'production_colors:manage');

INSERT INTO `RolePermission` (`id`, `roleId`, `permissionId`)
SELECT REPLACE(UUID(), '-', ''), r.`id`, p.`id`
FROM `RoleDefinition` r
CROSS JOIN `Permission` p
WHERE r.`name` IN ('ADMIN', 'PRODUCTION')
  AND p.`code` = 'production_colors:manage'
  AND NOT EXISTS (
    SELECT 1 FROM `RolePermission` rp
    WHERE rp.`roleId` = r.`id` AND rp.`permissionId` = p.`id`
  );
