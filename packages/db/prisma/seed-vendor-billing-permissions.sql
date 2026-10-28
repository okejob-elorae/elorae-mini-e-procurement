-- Post-merge surgical seed for the Vendor Billing permissions (prod pattern).
-- Run against prod after migrate:deploy. Idempotent.
-- Mirrors seed-item-request-permissions.sql. Admin wildcard covers the grant;
-- grant to the purchaser / finance roles from Akun Profil > Roles as needed.
-- Vendor bill payments reuse supplier_payments:view / supplier_payments:create.

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'vendor_bills:view', 'vendor_bills', 'view', 'View vendor bills'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'vendor_bills:view');

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'vendor_bills:manage', 'vendor_bills', 'manage', 'Create and void vendor bills'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'vendor_bills:manage');
