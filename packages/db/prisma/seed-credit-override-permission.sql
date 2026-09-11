-- Post-merge surgical seed for the credit-limit override permission (prod pattern).
-- Run against prod after migrate:deploy. Idempotent.
--
-- The admin wildcard is granted in code (`RoleDefinition.isSystem`), so ADMIN works with or
-- without this row. It exists so a real approver role can be granted the override capability
-- separately from ordinary order approval, and so it appears in role management.

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'field_sales_orders:credit_override', 'field_sales_orders', 'credit_override', 'Approve a putus order that exceeds its store credit limit, with a reason'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'field_sales_orders:credit_override');

INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'ADMIN'
  AND p.code = 'field_sales_orders:credit_override'
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );
