-- Post-merge surgical seed for the field retur receiving permissions.
-- Run against prod after migrate:deploy. Idempotent.
--
-- Both are decoration on the current deployment: ADMIN holds everything through the code-level
-- `RoleDefinition.isSystem` wildcard, so nothing changes today. They exist so retur receiving can
-- later be granted to a warehouse role without also granting putus approval, and so write-off —
-- the one option where a loss is absorbed and nobody bears it — can stay owner-only at that point.

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'field_returns:manage', 'field_returns', 'manage', 'Receive field returns, resolve discrepancies and approve them'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'field_returns:manage');

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'field_returns:writeoff', 'field_returns', 'writeoff', 'Absorb a field retur shortage as a company loss'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'field_returns:writeoff');

INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'ADMIN'
  AND p.code IN ('field_returns:manage', 'field_returns:writeoff')
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );
