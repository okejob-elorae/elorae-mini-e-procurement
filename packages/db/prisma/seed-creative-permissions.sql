-- Izin creative marketing (MariaDB, pola prod). Idempoten — aman dijalankan ulang.
-- Setara postgres/seed-creative-permissions.sql; alasan pemisahannya ditulis di sana.
-- Jalankan di prod SESUDAH migrate:deploy (pipeline deploy tidak pernah men-seed).

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'creative:view', 'creative', 'view',
       'Open the content calendar, KOL briefs and the KOL directory'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'creative:view');

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'creative:manage', 'creative', 'manage',
       'Create and move KOL briefs, which issues product stock, and edit content plans'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'creative:manage');

INSERT INTO `RolePermission` (`id`, `roleId`, `permissionId`)
SELECT REPLACE(UUID(), '-', ''), r.`id`, p.`id`
FROM `RoleDefinition` r
CROSS JOIN `Permission` p
WHERE r.`name` = 'ADMIN'
  AND p.`code` IN ('creative:view', 'creative:manage')
  AND NOT EXISTS (
    SELECT 1 FROM `RolePermission` rp
    WHERE rp.`roleId` = r.`id` AND rp.`permissionId` = p.`id`
  );
