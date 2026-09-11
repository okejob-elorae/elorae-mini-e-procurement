-- Post-merge surgical seed for the faktur pajak permissions (prod pattern).
-- Run against prod after migrate:deploy. Idempotent.
--
-- The admin wildcard is granted in code (`RoleDefinition.isSystem`), so ADMIN works with or
-- without these rows. They exist so a real finance role can be granted the capability and so it
-- appears in role management.

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'tax_invoices:view', 'tax_invoices', 'view', 'View the faktur pajak queue for issued nota tagihan'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'tax_invoices:view');

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'tax_invoices:manage', 'tax_invoices', 'manage', 'Record faktur pajak numbers and dismiss nota that need no faktur'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'tax_invoices:manage');

INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'ADMIN'
  AND p.code IN ('tax_invoices:view', 'tax_invoices:manage')
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );
