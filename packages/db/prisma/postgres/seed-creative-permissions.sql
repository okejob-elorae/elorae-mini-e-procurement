-- Izin creative marketing (PostgreSQL / Supabase). Idempoten — aman diulang.
--
-- Dipisah dari `sales_orders:*`: orang yang merencanakan konten Instagram bukan
-- orang yang menyetujui pesanan lapangan, dan tidak satu pun dari mereka boleh
-- mewarisi layar yang lain hanya karena keduanya menyentuh kata "marketing".

INSERT INTO "Permission" (id, code, module, action, description)
SELECT gen_random_uuid()::text, 'creative:view', 'creative', 'view',
       'Open the content calendar, KOL briefs and the KOL directory'
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = 'creative:view');

INSERT INTO "Permission" (id, code, module, action, description)
SELECT gen_random_uuid()::text, 'creative:manage', 'creative', 'manage',
       'Create and move KOL briefs, which issues product stock, and edit content plans'
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = 'creative:manage');

INSERT INTO "RolePermission" (id, "roleId", "permissionId")
SELECT gen_random_uuid()::text, r.id, p.id
FROM "RoleDefinition" r
CROSS JOIN "Permission" p
WHERE r.name = 'ADMIN'
  AND p.code IN ('creative:view', 'creative:manage')
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
  );
