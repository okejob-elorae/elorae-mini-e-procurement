-- Izin konsinyasi (MariaDB, pola prod). Idempoten — aman dijalankan ulang.
-- Setara postgres/seed-consignment-permissions.sql; alasan pemisahannya ditulis di sana.
-- Jalankan di prod SESUDAH migrate:deploy dan SESUDAH seed-receivables-permissions.sql:
-- dua langkah terakhir di bawah menurunkan izin dari pemegang `receivables:*`, jadi
-- urutan yang terbalik diam-diam tidak memberi apa pun ke peran non-admin.

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'consignment:view', 'consignment', 'view',
       'Open consignment cycles, their reports and their commissions'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'consignment:view');

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'consignment:manage', 'consignment', 'manage',
       'Run a consignment cycle: lock the figures, pay commission, record the tax invoice number'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'consignment:manage');

-- ADMIN sudah lolos lewat wildcard di kode, tapi tautannya tetap dibuat supaya
-- izinnya muncul di manajemen peran.
INSERT INTO `RolePermission` (`id`, `roleId`, `permissionId`)
SELECT REPLACE(UUID(), '-', ''), r.`id`, p.`id`
FROM `RoleDefinition` r
CROSS JOIN `Permission` p
WHERE r.`name` = 'ADMIN'
  AND p.`code` IN ('consignment:view', 'consignment:manage')
  AND NOT EXISTS (
    SELECT 1 FROM `RolePermission` rp
    WHERE rp.`roleId` = r.`id` AND rp.`permissionId` = p.`id`
  );

-- Setiap peran yang HARI INI memegang `receivables:manage` sudah menjalankan
-- konsinyasi. Tanpa baris ini, menambah izin baru justru mengunci orang yang
-- sedang bekerja.
INSERT INTO `RolePermission` (`id`, `roleId`, `permissionId`)
SELECT REPLACE(UUID(), '-', ''), rp_ada.`roleId`, p.`id`
FROM `RolePermission` rp_ada
JOIN `Permission` p_ada ON p_ada.`id` = rp_ada.`permissionId` AND p_ada.`code` = 'receivables:manage'
CROSS JOIN `Permission` p
WHERE p.`code` IN ('consignment:view', 'consignment:manage')
  AND NOT EXISTS (
    SELECT 1 FROM `RolePermission` rp
    WHERE rp.`roleId` = rp_ada.`roleId` AND rp.`permissionId` = p.`id`
  );

-- Yang hanya memegang `receivables:view` mendapat `consignment:view` saja:
-- boleh melihat siklusnya, tidak boleh menguncinya.
INSERT INTO `RolePermission` (`id`, `roleId`, `permissionId`)
SELECT REPLACE(UUID(), '-', ''), rp_ada.`roleId`, p.`id`
FROM `RolePermission` rp_ada
JOIN `Permission` p_ada ON p_ada.`id` = rp_ada.`permissionId` AND p_ada.`code` = 'receivables:view'
CROSS JOIN `Permission` p
WHERE p.`code` = 'consignment:view'
  AND NOT EXISTS (
    SELECT 1 FROM `RolePermission` rp
    WHERE rp.`roleId` = rp_ada.`roleId` AND rp.`permissionId` = p.`id`
  );
