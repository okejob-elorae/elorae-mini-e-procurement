-- Post-merge surgical seed for pack-ratio settings permissions (prod pattern).
-- Run against prod after migrate:deploy. Idempotent.
-- Mirrors seed-spg-role-permissions.sql. Admin wildcard covers the grant;
-- these are NOT linked to any non-admin role.

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'settings_pack_ratio:view', 'settings_pack_ratio', 'view', 'View global pack ratio'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'settings_pack_ratio:view');

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'settings_pack_ratio:manage', 'settings_pack_ratio', 'manage', 'Manage global pack ratio'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'settings_pack_ratio:manage');
