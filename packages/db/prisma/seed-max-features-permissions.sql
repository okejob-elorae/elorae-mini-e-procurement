-- Permission rows for the features that came in with Max's branch (receivables, consignment,
-- creative/KOL, production palette). The deploy workflow migrates but never seeds, so run this
-- by hand on prod ONCE, after the 20261031100000_merge_max_features migration has deployed.
-- Every statement is NOT EXISTS-guarded: re-running it is a no-op.
--
--   mariadb --skip-ssl -u<user> -p <db> < seed-max-features-permissions.sql
--
-- ADMIN already passes every check through the '*' wildcard granted in code (apps/web/lib/auth.ts);
-- these rows exist so the permissions can be granted to NON-admin roles in role management.
-- The optional office roles (KEUANGAN, ADMIN_PENJUALAN, ADMIN_PAJAK) are NOT created here — that is
-- seed-office-roles-permissions.sql, to be run only once the owner decides those roles.
-- Concatenated from seed-receivables-permissions.sql, seed-consignment-permissions.sql,
-- seed-creative-permissions.sql and seed-production-palette-permissions.sql, in that order
-- (consignment grants itself to every role that already holds a receivables permission).

START TRANSACTION;

-- ===== from seed-receivables-permissions.sql =====

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

-- ===== from seed-consignment-permissions.sql =====

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

-- ===== from seed-creative-permissions.sql =====

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

-- ===== from seed-production-palette-permissions.sql =====

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

COMMIT;

-- Check: expect 7 rows (receivables:view may already have existed before this file ran).
SELECT `code` FROM `Permission`
WHERE `code` IN ('receivables:view', 'receivables:manage', 'consignment:view', 'consignment:manage',
                 'creative:view', 'creative:manage', 'production_colors:manage')
ORDER BY `code`;
