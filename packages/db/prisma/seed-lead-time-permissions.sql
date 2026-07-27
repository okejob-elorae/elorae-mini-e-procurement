-- Post-merge surgical seed for lead_time permissions (prod pattern).
-- Run against prod after migrate:deploy. Idempotent.

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'lead_time:view', 'lead_time', 'view', 'View process library and supplier chains'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'lead_time:view');

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'lead_time:manage', 'lead_time', 'manage', 'Manage process library and supplier chains'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'lead_time:manage');

INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'ADMIN'
  AND p.code IN ('lead_time:view', 'lead_time:manage')
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );

INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'PURCHASER'
  AND p.code = 'lead_time:view'
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );
