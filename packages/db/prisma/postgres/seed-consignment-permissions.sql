-- Izin konsinyasi (PostgreSQL / Supabase). Idempoten — aman dijalankan ulang.
--
-- Sebelum ini halaman konsinyasi dan arsip retur digantungkan pada
-- `sales_orders:view` — izin yang tidak ada urusannya dengan keduanya — dan
-- halamannya sendiri tidak berpagar sama sekali: siapa pun yang bisa masuk
-- membuka setiap nota retur setiap toko, lengkap dengan fotonya.
--
-- Konsinyasi dipisah dari `receivables:*` dengan sengaja. Brief menyebut dua
-- peran, Admin Penjualan dan Admin Pajak, yang pekerjaannya HANYA konsinyasi
-- dan yang secara tegas tidak boleh membuka lampiran di luarnya. Kalau
-- konsinyasi memakai izin piutang, memberi mereka pekerjaannya berarti
-- sekalian menyerahkan seluruh arsip retur.

INSERT INTO "Permission" (id, code, module, action, description)
SELECT gen_random_uuid()::text, 'consignment:view', 'consignment', 'view',
       'Open consignment cycles, their reports and their commissions'
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = 'consignment:view');

INSERT INTO "Permission" (id, code, module, action, description)
SELECT gen_random_uuid()::text, 'consignment:manage', 'consignment', 'manage',
       'Run a consignment cycle: lock the figures, pay commission, record the tax invoice number'
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = 'consignment:manage');

-- ADMIN sudah lolos lewat wildcard di kode, tapi tautannya tetap dibuat supaya
-- izinnya muncul di manajemen peran.
INSERT INTO "RolePermission" (id, "roleId", "permissionId")
SELECT gen_random_uuid()::text, r.id, p.id
FROM "RoleDefinition" r
CROSS JOIN "Permission" p
WHERE r.name = 'ADMIN'
  AND p.code IN ('consignment:view', 'consignment:manage')
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
  );

-- INI BAGIAN YANG PENTING: setiap peran yang HARI INI memegang
-- `receivables:manage` sudah menjalankan konsinyasi. Tanpa baris di bawah,
-- menambah izin baru justru MENGUNCI orang yang sedang bekerja — dan pemisahan
-- tugas yang mengunci orang yang berhak akan dicabut lagi minggu depan.
INSERT INTO "RolePermission" (id, "roleId", "permissionId")
SELECT gen_random_uuid()::text, rp_ada."roleId", p.id
FROM "RolePermission" rp_ada
JOIN "Permission" p_ada ON p_ada.id = rp_ada."permissionId" AND p_ada.code = 'receivables:manage'
CROSS JOIN "Permission" p
WHERE p.code IN ('consignment:view', 'consignment:manage')
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp
    WHERE rp."roleId" = rp_ada."roleId" AND rp."permissionId" = p.id
  );

-- Yang hanya memegang `receivables:view` mendapat `consignment:view` saja:
-- boleh melihat siklusnya, tidak boleh menguncinya.
INSERT INTO "RolePermission" (id, "roleId", "permissionId")
SELECT gen_random_uuid()::text, rp_ada."roleId", p.id
FROM "RolePermission" rp_ada
JOIN "Permission" p_ada ON p_ada.id = rp_ada."permissionId" AND p_ada.code = 'receivables:view'
CROSS JOIN "Permission" p
WHERE p.code = 'consignment:view'
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp
    WHERE rp."roleId" = rp_ada."roleId" AND rp."permissionId" = p.id
  );
