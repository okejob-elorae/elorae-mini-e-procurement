-- Post-merge surgical seed for the SPG commission rate permission (prod pattern).
-- Run against prod after migrate:deploy. Idempotent.
-- Mirrors seed-pack-ratio-permissions.sql. Admin wildcard covers the grant;
-- this is NOT linked to any non-admin role.

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'spg_commission:manage', 'spg_commission', 'manage', 'Manage SPG commission rates per item category'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'spg_commission:manage');
