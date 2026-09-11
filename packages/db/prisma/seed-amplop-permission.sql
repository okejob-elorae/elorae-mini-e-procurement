-- Post-merge surgical seed for the amplop digital permission (prod pattern).
-- Run BY HAND against prod after deploy. Idempotent. No migration applies this — this repo's
-- migrations never seed permission rows, and nothing on the deploy path seeds them either.
--
-- Without this row the amplop route is unreachable for every non-admin: the page guard refuses,
-- and the PWA home entry never renders. ADMIN gets the grant below purely to mirror `seed.ts`
-- (ADMIN is assigned every `Permission` row) — it buys ADMIN nothing functionally, because
-- `pwaAccessGuard` redirects any wildcard holder to `/backoffice` BEFORE the permission check
-- ever runs (`RoleDefinition.isSystem` -> `['*']`). An admin can never reach `/pwa/pelunasan` to
-- begin with, seeded or not, so an admin smoke test proves nothing either way.
-- Post-seed verification on production must be done on a SALESMAN or COLLECTOR account.
--
-- Three roles get this code:
--   SALESMAN  — created non-system by `seed.ts`, already holds `pwa:access`; reaches the amplop
--               through the order-salesman arm of the store-set union.
--   COLLECTOR — created non-system by `seed-collections-permissions.sql`, holds `pwa:access` +
--               `collections:collect`; this is the role actually stamped into
--               `Receivable.collectorId` by `listCollectorCandidates()`, so it is the role the
--               COLLECTOR-id arm of the union exists for. Omitting it left every real collector
--               unable to see the screen while the collectorId arm never fired for anybody.
--   ADMIN     — convention-mirroring only, see above; functionally inert.
-- If `SELECT * FROM RoleDefinition WHERE name IN ('SALESMAN', 'COLLECTOR')` is missing either row
-- on the target database, that role's grant below silently no-ops — check first.

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

-- COLLECTOR is the role actually stamped into Receivable.collectorId — without this grant the
-- collectorId arm of the union never fires for anybody.
INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'COLLECTOR'
  AND p.code = 'collections:amplop'
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );

-- Bump permissionsVersion on every role that just gained the code, so users already holding a
-- session pick it up without being forced to log out and back in.
UPDATE RoleDefinition
SET permissionsVersion = permissionsVersion + 1
WHERE name IN ('ADMIN', 'SALESMAN', 'COLLECTOR');
