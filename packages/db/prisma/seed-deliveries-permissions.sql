-- Post-merge surgical seed for the delivery-shipment permissions (prod pattern).
-- Run BY HAND against prod after migrate:deploy. Idempotent. No migration applies this — this
-- repo's migrations never seed permission rows.
--
-- Unlike most permission seeds, this one is not a convenience: `deliveries:pod` and
-- `deliveries:ship` have never been seeded anywhere, and `listCarrierCandidates` (the carrier
-- picker behind every salesman-carry shipment) selects users whose role is `isSystem = 0` AND
-- holds BOTH `deliveries:pod` and `pwa:access`. Without these rows the picker is permanently
-- empty, `shipDeliveryShipment` refuses every salesman-carry shipment with MISSING_CARRIER, and
-- the whole salesman-carry path is unusable. The admin wildcard is granted in code
-- (`RoleDefinition.isSystem`), so ADMIN is unaffected either way — and granting these to ADMIN
-- alone still leaves the picker empty, because that filter demands a NON-system role.
--
-- SALESMAN is the target role: created non-system by `seed.ts` and already holding `pwa:access`,
-- so `deliveries:pod` is the only piece missing. The `pwa:access` grant below is a no-op where it
-- is already in place and makes this file self-sufficient. If `SELECT * FROM RoleDefinition WHERE
-- name = 'SALESMAN'` returns nothing on the target database, the grants below silently no-op —
-- check that first, and grant the same two codes to whichever non-system PWA role exists instead.

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'deliveries:ship', 'deliveries', 'ship', 'Pack, track, ship and cancel delivery shipments'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'deliveries:ship');

INSERT INTO Permission (id, code, module, action, description)
SELECT REPLACE(UUID(), '-', ''), 'deliveries:pod', 'deliveries', 'pod', 'Close a delivery shipment against proof of delivery; be eligible for assignment as a salesman carrier'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Permission WHERE code = 'deliveries:pod');

-- ADMIN gets both new permissions (ADMIN is assigned every Permission row explicitly, mirrors seed.ts)
INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'ADMIN'
  AND p.code IN ('deliveries:ship', 'deliveries:pod')
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );

-- SALESMAN gets deliveries:pod (+ pwa:access, already granted by seed.ts, re-asserted here so
-- this file alone is enough to make the carrier picker non-empty). NOT deliveries:ship — packing
-- and shipping stay with the backoffice; a salesman only closes what an admin handed them.
INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'SALESMAN'
  AND p.code IN ('pwa:access', 'deliveries:pod')
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );
