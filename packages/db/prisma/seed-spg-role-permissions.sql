-- Post-merge surgical seed for the SPG role (prod pattern).
-- Run against prod after migrate:deploy. Idempotent.
-- Mirrors seed-lead-time-permissions.sql / the SALESMAN role seed in seed.ts.

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'spg_sales:record', 'spg_sales', 'record', 'Record SPG in-store sales'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'spg_sales:record');

-- Admin-viewed backoffice register permission (admin wildcard covers the grant; NOT linked to the SPG role).
INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'spg_sales:view', 'spg_sales', 'view', 'View SPG in-store sales register'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'spg_sales:view');

INSERT INTO RoleDefinition (id, name, description, isSystem, permissionsVersion, createdAt, updatedAt)
SELECT REPLACE(UUID(), '-', ''), 'SPG', 'In-store promoter — PWA-only access, fixed to one store', 0, 1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM RoleDefinition WHERE name = 'SPG');

-- SPG gets pwa:access + spg_sales:record
INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'SPG'
  AND p.code IN ('pwa:access', 'spg_sales:record')
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );

-- ADMIN gets the new permission too (ADMIN is assigned every Permission row explicitly, mirrors seed.ts)
INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'ADMIN'
  AND p.code = 'spg_sales:record'
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );
