-- Post-merge surgical seed for collections permissions + a dedicated Collector role (prod pattern).
-- Run against prod after migrate:deploy. Idempotent.
--
-- The admin wildcard is granted in code (`RoleDefinition.isSystem`), so ADMIN works with or
-- without these rows. They exist so a real collections/finance role can be granted the
-- capability, and so a "dedicated collector" is pure data — a seeded RoleDefinition holding
-- pwa:access + collections:collect, same shape as the SPG role.

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'collections:collect', 'collections', 'collect', 'Submit a collection from the PWA; be eligible for assignment as a collector'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'collections:collect');

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'collections:manage', 'collections', 'manage', 'Assign/unassign a collector to a receivable; view the verification queue'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'collections:manage');

-- ADMIN gets both new permissions (ADMIN is assigned every Permission row explicitly, mirrors seed.ts)
INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'ADMIN'
  AND p.code IN ('collections:collect', 'collections:manage')
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );

INSERT INTO RoleDefinition (id, name, description, isSystem, permissionsVersion, createdAt, updatedAt)
SELECT REPLACE(UUID(), '-', ''), 'COLLECTOR', 'Dedicated field collector — PWA collection queue only', 0, 1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM RoleDefinition WHERE name = 'COLLECTOR');

-- COLLECTOR gets pwa:access + collections:collect only (not collections:manage — a dedicated
-- collector submits collections, they don't assign work to others)
INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'COLLECTOR'
  AND p.code IN ('pwa:access', 'collections:collect')
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );
