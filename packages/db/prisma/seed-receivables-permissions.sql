-- Izin piutang & pelunasan (MariaDB, pola prod). Idempoten — aman dijalankan ulang.
-- Setara postgres/seed-receivables-permissions.sql. Jalankan di prod SESUDAH migrate:deploy
-- (pipeline deploy memigrasi tapi tidak pernah men-seed), dan SEBELUM
-- seed-consignment-permissions.sql, yang menurunkan izin konsinyasi dari baris di sini.
--
-- Wildcard admin diberikan di kode (`RoleDefinition.isSystem`), jadi ADMIN sudah bisa
-- membuka dan mengelola piutang tanpa baris ini. Barisnya ada supaya peran penagihan
-- non-admin bisa diberi izinnya, dan supaya izinnya tampil di manajemen peran.

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'receivables:view', 'receivables', 'view',
       'View receivables, collection notes and payment claims'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'receivables:view');

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'receivables:manage', 'receivables', 'manage',
       'Hand invoices over to a shop on a collection note, and close or cancel one'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'receivables:manage');

INSERT INTO `RolePermission` (`id`, `roleId`, `permissionId`)
SELECT REPLACE(UUID(), '-', ''), r.`id`, p.`id`
FROM `RoleDefinition` r
CROSS JOIN `Permission` p
WHERE r.`name` = 'ADMIN'
  AND p.`code` IN ('receivables:view', 'receivables:manage')
  AND NOT EXISTS (
    SELECT 1 FROM `RolePermission` rp
    WHERE rp.`roleId` = r.`id` AND rp.`permissionId` = p.`id`
  );
