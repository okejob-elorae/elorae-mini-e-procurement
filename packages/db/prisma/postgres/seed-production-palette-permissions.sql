-- Izin mengelola palet warna produksi (PostgreSQL / Supabase). Idempoten — aman diulang.
--
-- Palet warna dan warna sablon pindah dari modul kreatif ke produksi. Melihat
-- halaman memakai `production_colors:view` yang sudah ada; menyimpan palet dan
-- daftar tinta dasar tim butuh izin baru ini. ADMIN sebenarnya lolos lewat
-- wildcard di kode — baris ini ada supaya izinnya bisa diberikan ke peran lain
-- dan tampil di pengaturan peran.

INSERT INTO "Permission" (id, code, module, action, description)
SELECT gen_random_uuid()::text, 'production_colors:manage', 'production_colors', 'manage',
       'Save colour palettes and the team base inks used for print mix recipes'
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = 'production_colors:manage');

INSERT INTO "RolePermission" (id, "roleId", "permissionId")
SELECT gen_random_uuid()::text, r.id, p.id
FROM "RoleDefinition" r
CROSS JOIN "Permission" p
WHERE r.name IN ('ADMIN', 'PRODUCTION')
  AND p.code = 'production_colors:manage'
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
  );
