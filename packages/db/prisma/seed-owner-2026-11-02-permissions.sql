-- Izin baru dari keputusan pemilik 2026-11-02 (MariaDB, produksi). Deploy hanya memigrasi dan tidak
-- pernah menyeed, jadi berkas ini dijalankan dengan tangan sesudah image web yang membawa kedua izin
-- ini hidup — dan SEBELUM seed-office-roles-permissions.sql, yang hanya menautkan izin yang sudah ada
-- dan berhenti dengan ERROR 1242 sebelum menulis apa pun kalau spg_returns:approve belum ada.
--
--   mariadb --skip-ssl -u<user> -p <db> < seed-owner-2026-11-02-permissions.sql
--
--   spg_returns:approve    — menyetujui atau menolak laporan retur pembeli yang dicatat SPG di konter.
--                            Persetujuan; bawaannya admin DAN ADMIN_PENJUALAN (keputusan pemilik
--                            2026-11-02; PERSETUJUAN_BAWAAN_PERAN_KANTOR di apps/web/lib/rbac/penjelasan-izin.ts).
--   jubelio_prices:confirm — mengonfirmasi harga jual sebelum dikirim ke Jubelio. Persetujuan; bawaannya
--                            hanya admin, tidak diberikan ke peran lain.
--
-- ADMIN sudah lolos setiap pemeriksaan lewat wildcard '*' yang diberikan di kode; tautan ADMIN di bawah
-- ditulis supaya sama dengan seed.ts. Sampai baris Permission ada, getUsersWithPermission hanya
-- menemukan admin sistem, jadi lonceng RETUR_PEMBELI_MENUNGGU tetap sampai ke admin.
--
-- Sengaja berkas sendiri, BUKAN tambahan seed-max-features-permissions.sql: berkas itu dijalankan sekali,
-- dan menjalankannya ulang memberikan lagi tautan turunan (konsinyasi dari izin piutang, palet untuk
-- PRODUCTION) yang mungkin sudah dicabut pemilik di Peran & izin.
--
-- Idempoten: setiap INSERT dijaga NOT EXISTS. Tautan ADMIN_PENJUALAN → spg_returns:approve hanya ditulis
-- pada run yang MEMBUAT baris spg_returns:approve (sekali saja, seperti pewarisan payments:verify), jadi
-- menjalankan ulang berkas ini tidak pernah mengembalikan izin yang sudah dicabut pemilik. Kalau peran
-- ADMIN_PENJUALAN belum ada saat itu, seed-office-roles-permissions.sql yang memberikannya saat
-- membuat peran itu.

START TRANSACTION;

-- Ditangkap SEBELUM barisnya dibuat: tautan bawaan ADMIN_PENJUALAN hanya ditulis pada run yang membuatnya.
SET @spg_returns_approve_is_new = (SELECT COUNT(*) FROM `Permission` WHERE `code` = 'spg_returns:approve') = 0;

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'spg_returns:approve', 'spg_returns', 'approve',
       'Approve or reject an SPG''s report of goods a shopper returned at the counter (manager decision, admin and sales admin by default)'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'spg_returns:approve');

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'jubelio_prices:confirm', 'jubelio_prices', 'confirm',
       'Confirm selling prices before they are sent to Jubelio'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'jubelio_prices:confirm');

-- ADMIN mendapat kedua baris secara eksplisit, sama dengan seed.ts (tanpa pengaruh: ADMIN lolos lewat '*').
INSERT INTO `RolePermission` (`id`, `roleId`, `permissionId`)
SELECT REPLACE(UUID(), '-', ''), r.`id`, p.`id`
FROM `RoleDefinition` r
CROSS JOIN `Permission` p
WHERE r.`name` = 'ADMIN'
  AND p.`code` IN ('spg_returns:approve', 'jubelio_prices:confirm')
  AND NOT EXISTS (
    SELECT 1 FROM `RolePermission` rp
    WHERE rp.`roleId` = r.`id` AND rp.`permissionId` = p.`id`
  );

-- Bawaan pemilik, SEKALI: ADMIN_PENJUALAN yang sudah ada ikut menyetujui retur pembeli SPG.
INSERT INTO `RolePermission` (`id`, `roleId`, `permissionId`)
SELECT REPLACE(UUID(), '-', ''), r.`id`, p.`id`
FROM `RoleDefinition` r
CROSS JOIN `Permission` p
WHERE r.`name` = 'ADMIN_PENJUALAN'
  AND p.`code` = 'spg_returns:approve'
  AND @spg_returns_approve_is_new = 1
  AND NOT EXISTS (
    SELECT 1 FROM `RolePermission` rp
    WHERE rp.`roleId` = r.`id` AND rp.`permissionId` = p.`id`
  );

-- Pengguna ADMIN_PENJUALAN yang sudah masuk mendapat izin barunya tanpa keluar (lib/auth.ts membandingkan versinya).
UPDATE `RoleDefinition`
SET `permissionsVersion` = `permissionsVersion` + 1
WHERE @spg_returns_approve_is_new = 1
  AND `name` = 'ADMIN_PENJUALAN';

COMMIT;

-- Cek: dua baris.
SELECT `code`, `description` FROM `Permission`
WHERE `code` IN ('spg_returns:approve', 'jubelio_prices:confirm')
ORDER BY `code`;

-- Cek: peran yang memegang kedua izin ini. Bawaannya ADMIN untuk keduanya, ditambah ADMIN_PENJUALAN untuk
-- spg_returns:approve (kalau peran itu sudah ada); peran lain hanya bila pemilik memberikannya di layar.
SELECT r.`name` AS `role`, p.`code` AS `code`
FROM `RoleDefinition` r
JOIN `RolePermission` rp ON rp.`roleId` = r.`id`
JOIN `Permission` p ON p.`id` = rp.`permissionId`
WHERE p.`code` IN ('spg_returns:approve', 'jubelio_prices:confirm')
ORDER BY p.`code`, r.`name`;
