-- Post-merge surgical seed for the Request Item permissions (prod pattern).
-- Run against prod after migrate:deploy. Idempotent.
-- Mirrors seed-spg-commission-permission.sql. Admin wildcard covers the grant;
-- grant to the purchaser / production roles from Akun Profil > Roles as needed.

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'item_requests:view', 'item_requests', 'view', 'View material requests'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'item_requests:view');

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'item_requests:manage', 'item_requests', 'manage', 'Create, cancel and convert material requests to POs'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'item_requests:manage');
