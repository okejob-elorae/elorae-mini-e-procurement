-- Post-merge surgical seed for the field-sales delivery permission (prod pattern).
-- Run against prod after migrate:deploy. Idempotent.
-- Mirrors seed-pack-ratio-permissions.sql / seed-spg-role-permissions.sql.
--
-- Without this row the delivery UI and its server actions are gated to ADMIN only: the admin
-- wildcard is granted in code (`RoleDefinition.isSystem`), so ADMIN works with or without the row,
-- but no other role can be granted the permission and it never appears in role management.

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'field_sales_orders:deliver', 'field_sales_orders', 'deliver', 'Record deliveries and close the remainder on field-sales (putus) orders'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'field_sales_orders:deliver');

-- ADMIN gets the new permission too (ADMIN is assigned every Permission row explicitly, mirrors seed.ts)
INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'ADMIN'
  AND p.code = 'field_sales_orders:deliver'
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );
