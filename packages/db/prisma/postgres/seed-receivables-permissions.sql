-- Seed for the receivables/collections permissions (PostgreSQL / Supabase).
-- Idempotent — safe to re-run.
--
-- The admin wildcard is granted in code (`RoleDefinition.isSystem`), so ADMIN can already open
-- and manage collection notes without these rows. They exist so a non-admin collections role can
-- be granted the capability, and so it shows up in role management.

INSERT INTO "Permission" (id, code, module, action, description)
SELECT gen_random_uuid()::text, 'receivables:view', 'receivables', 'view',
       'View receivables, collection notes and payment claims'
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = 'receivables:view');

INSERT INTO "Permission" (id, code, module, action, description)
SELECT gen_random_uuid()::text, 'receivables:manage', 'receivables', 'manage',
       'Hand invoices over to a shop on a collection note, and close or cancel one'
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = 'receivables:manage');

INSERT INTO "RolePermission" (id, "roleId", "permissionId")
SELECT gen_random_uuid()::text, r.id, p.id
FROM "RoleDefinition" r
CROSS JOIN "Permission" p
WHERE r.name = 'ADMIN'
  AND p.code IN ('receivables:view', 'receivables:manage')
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
  );
