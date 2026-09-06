-- Post-merge surgical seed for the settlement-document permission (prod pattern).
-- Run BY HAND against prod after deploy. Idempotent. No migration applies this — this repo's
-- migrations never seed permission rows, and nothing on the deploy path seeds them either.
--
-- Without this row the settlement screen is unreachable for every non-admin: the store detail
-- page guard refuses, `submitStoreSettlementAction`'s guard refuses, and the proof upload route
-- refuses — while `AmplopList`'s Settle button used to render unconditionally regardless, sending
-- a salesman into a dead end with no message. This seed pairs with the button now being gated on
-- the same permission it renders for.
-- Post-seed verification on production must be done on a SALESMAN or COLLECTOR account.
--
-- Three roles get this code:
--   SALESMAN  — created non-system by `seed.ts`, already holds `pwa:access`; this is the feature's
--               own framing — "the document a salesman fills in at a counter" — and per the seed
--               it previously held nothing that let it reach the screen.
--   COLLECTOR — created non-system by `seed-collections-permissions.sql`, holds `pwa:access` +
--               `collections:collect`; a collector settling a store's invoices at the counter is
--               the same actor the amplop's collector-id arm already exists for.
--   ADMIN     — convention-mirroring only, see `seed-amplop-permission.sql`'s header for the full
--               reasoning — functionally inert, because `pwaAccessGuard` redirects any wildcard
--               holder to `/backoffice` BEFORE the permission check ever runs
--               (`RoleDefinition.isSystem` -> `['*']`). An admin can never reach
--               `/pwa/pelunasan/[storeId]` to begin with, seeded or not, so an admin smoke test
--               proves nothing either way.
-- If `SELECT * FROM RoleDefinition WHERE name IN ('SALESMAN', 'COLLECTOR')` is missing either row
-- on the target database, that role's grant below silently no-ops — check first.

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'settlements:submit', 'settlements', 'submit', 'Submit a store settlement document (invoices + deductions) from the PWA counter screen'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'settlements:submit');

-- ADMIN gets it explicitly, mirroring seed.ts (ADMIN is assigned every Permission row).
INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'ADMIN'
  AND p.code = 'settlements:submit'
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );

INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'SALESMAN'
  AND p.code = 'settlements:submit'
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );

INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'COLLECTOR'
  AND p.code = 'settlements:submit'
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );

-- Bump permissionsVersion on every role that just gained the code, so users already holding a
-- session pick it up without being forced to log out and back in.
UPDATE RoleDefinition
SET permissionsVersion = permissionsVersion + 1
WHERE name IN ('ADMIN', 'SALESMAN', 'COLLECTOR');
