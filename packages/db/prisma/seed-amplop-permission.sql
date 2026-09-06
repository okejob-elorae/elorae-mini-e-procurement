-- Post-merge surgical seed for the amplop digital permission (prod pattern).
-- Run BY HAND against prod after deploy. Idempotent. No migration applies this — this repo's
-- migrations never seed permission rows, and nothing on the deploy path seeds them either.
--
-- Without this row the amplop route is unreachable for every non-admin: the page guard refuses,
-- and the PWA home entry never renders. The admin wildcard is granted in CODE
-- (`RoleDefinition.isSystem` -> ['*']), so ADMIN is unaffected either way — seeding does not
-- "unblock admin", it makes the permission grantable to the non-system roles that need it.
--
-- SALESMAN is the target role: created non-system by `seed.ts` and already holding `pwa:access`.
-- If `SELECT * FROM RoleDefinition WHERE name = 'SALESMAN'` returns nothing on the target
-- database, the grants below silently no-op — check that first and grant the same code to
-- whichever non-system PWA role exists instead.

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'collections:amplop', 'collections', 'amplop', 'View the read-only amplop digital: AR documents grouped by store for the round'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'collections:amplop');

-- ADMIN gets it explicitly, mirroring seed.ts (ADMIN is assigned every Permission row).
INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'ADMIN'
  AND p.code = 'collections:amplop'
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );

INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'SALESMAN'
  AND p.code = 'collections:amplop'
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );

-- Bump permissionsVersion on every role that just gained the code, so users already holding a
-- session pick it up without being forced to log out and back in.
UPDATE RoleDefinition
SET permissionsVersion = permissionsVersion + 1
WHERE name IN ('ADMIN', 'SALESMAN');
