-- Post-merge surgical seed for the PACKER role (prod pattern).
-- Run BY HAND against prod after deploy. Idempotent. No migration applies this —
-- this repo's migrations never seed permission rows, and nothing on the deploy path seeds them.
-- Mirrors seed-spg-role-permissions.sql / the PACKER block in seed.ts.
--
-- Creates:
--   packer:menu / packer:record / packer:edit Permission rows
--   PACKER RoleDefinition (non-system) with those three grants
--   ADMIN RolePermission links (convention-mirroring only; ADMIN wildcard already covers access)
--
-- Does NOT create a User row — passwords need bcrypt. For a login account use:
--   pnpm -F @elorae/db seed:packer-login
-- (additive; see that script's header for env overrides).
--
-- After this seed, Profile Accounts can also assign PACKER (or a custom role with these
-- checkboxes) to any user.

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'packer:menu', 'packer', 'menu', 'Access Record Packer menu and list'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'packer:menu');

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'packer:record', 'packer', 'record', 'Record packing videos'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'packer:record');

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'packer:edit', 'packer', 'edit', 'Replace existing packing videos'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'packer:edit');

INSERT INTO RoleDefinition (id, name, description, isSystem, permissionsVersion, createdAt, updatedAt)
SELECT REPLACE(UUID(), '-', ''), 'PACKER', 'Packer — Record Packer video packing surface', 0, 1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM RoleDefinition WHERE name = 'PACKER');

INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'PACKER'
  AND p.code IN ('packer:menu', 'packer:record', 'packer:edit')
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );

-- ADMIN gets every Permission row explicitly (mirrors seed.ts); wildcard already covers access.
INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'ADMIN'
  AND p.code IN ('packer:menu', 'packer:record', 'packer:edit')
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );

-- Bump so already-logged-in holders of these roles pick up the grant without re-login.
UPDATE RoleDefinition
SET permissionsVersion = permissionsVersion + 1
WHERE name IN ('ADMIN', 'PACKER');
