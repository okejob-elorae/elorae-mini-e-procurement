-- Peran kerja kantor: KEUANGAN, ADMIN_PENJUALAN, ADMIN_PAJAK (PostgreSQL — basis data lokal saja).
-- Salinan PostgreSQL dari ../seed-office-roles-permissions.sql; produksi (MariaDB) memakai berkas itu.
-- Daftar izin tiap peran, keterangan peran, dan isSystem = false WAJIB sama persis dengan berkas itu
-- dan dengan seed.ts — apps/web/lib/rbac/peran-kantor.test.ts membandingkan ketiganya.
--
--   psql "<DATABASE_URL>" -v ON_ERROR_STOP=1 -f seed-office-roles-permissions.sql
--
-- Urutan: jalankan SESUDAH seed.ts (`pnpm -F @elorae/db seed`). Berkas ini hanya MENAUTKAN izin yang
-- sudah ada, dan di PostgreSQL izin hasil pemecahan 2026-11-01 (payments:verify,
-- consignment:note_number, consignment:tax_number, …) hanya dibuat seed.ts. Kalau satu saja belum
-- ada, pemeriksaan pertama di bawah menghentikan berkas SEBELUM menulis apa pun: RAISE EXCEPTION
-- menggagalkan transaksi yang sedang terbuka, jadi setiap perintah sesudahnya ditolak dan COMMIT
-- menjadi ROLLBACK — juga tanpa ON_ERROR_STOP.
--
-- isSystem = false SELALU. Peran sistem mendapat wildcard '*' di kode (apps/web/lib/auth/segarkan-sesi.ts),
-- jadi true di sini = admin penuh. Kalau peran bernama sama sudah ada sebagai peran sistem, pemeriksaan
-- pertama juga menghentikan berkas — tidak diturunkan diam-diam.
--
-- Isi bawaan: pekerjaan yang menjadi alasan peran itu ada, ditambah izin lihat yang dibutuhkannya.
-- TIDAK ADA izin persetujuan (keputusan pemilik 2026-11-01 (8)) — bawaannya hanya admin; pemilik
-- memberikannya sendiri di Pengaturan → Peran & izin.
--   KEUANGAN        — periksa pembayaran (BKM, giro) ke mutasi bank, jurnal, laporan keuangan,
--                     pembayaran pemasok. Tidak mencatat BKM (tidak memegang receivables:manage).
--   ADMIN_PENJUALAN — nomor nota di siklus konsinyasi, ditambah izin lihat penjualan.
--   ADMIN_PAJAK     — nomor faktur pajak: antrean nota tagihan dan siklus konsinyasi.
--
-- Idempoten — aman dijalankan ulang. Menjalankan ulang tidak mencabut izin yang ditambahkan pemilik
-- di layar, dan juga tidak mencabut tautan yang ditulis versi lama berkas ini (versi lama memberi
-- ADMIN_PENJUALAN kelola piutang, konsinyasi, toko, dan promo serta menyetujui pesanan lapangan):
-- pemeriksaan terakhir menampilkannya untuk dicabut di layar. Keterangan lama peran diganti hanya bila
-- belum diubah pemilik.

BEGIN;

DO $$
BEGIN
  IF (
    SELECT COUNT(*) FROM "Permission" WHERE code IN (
      'dashboard:view', 'journals:view', 'journals:manage', 'coa:view', 'finance_reports:view',
      'payments:verify', 'receivables:view', 'tax_invoices:view', 'tax_invoices:manage',
      'supplier_payments:view', 'supplier_payments:create', 'supplier_payments:edit', 'purchase_orders:view',
      'consignment:view', 'consignment:note_number', 'consignment:tax_number', 'sales_orders:view',
      'field_sales_orders:view', 'stores:view', 'promos:view', 'spg_sales:view', 'sales_returns:view',
      'items:view'
    )
  ) <> 23
  OR EXISTS (
    SELECT 1 FROM "RoleDefinition"
    WHERE name IN ('KEUANGAN', 'ADMIN_PENJUALAN', 'ADMIN_PAJAK') AND "isSystem"
  ) THEN
    RAISE EXCEPTION 'ABORT: izin belum ada atau peran kantor bertanda sistem';
  END IF;
END $$;

INSERT INTO "RoleDefinition" (id, name, description, "isSystem", "permissionsVersion", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'KEUANGAN', 'Finance — verifies payments against the bank statement, journals and financial reports', false, 1, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "RoleDefinition" WHERE name = 'KEUANGAN');

INSERT INTO "RolePermission" (id, "roleId", "permissionId")
SELECT gen_random_uuid()::text, r.id, p.id
FROM "RoleDefinition" r
CROSS JOIN "Permission" p
WHERE r.name = 'KEUANGAN'
  AND p.code IN ('dashboard:view', 'journals:view', 'journals:manage', 'coa:view', 'finance_reports:view', 'payments:verify', 'receivables:view', 'tax_invoices:view', 'supplier_payments:view', 'supplier_payments:create', 'supplier_payments:edit', 'purchase_orders:view', 'consignment:view', 'sales_orders:view')
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
  );

INSERT INTO "RoleDefinition" (id, name, description, "isSystem", "permissionsVersion", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'ADMIN_PENJUALAN', 'Sales admin — records the sales-note number on consignment cycles', false, 1, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "RoleDefinition" WHERE name = 'ADMIN_PENJUALAN');

INSERT INTO "RolePermission" (id, "roleId", "permissionId")
SELECT gen_random_uuid()::text, r.id, p.id
FROM "RoleDefinition" r
CROSS JOIN "Permission" p
WHERE r.name = 'ADMIN_PENJUALAN'
  AND p.code IN ('dashboard:view', 'consignment:view', 'consignment:note_number', 'field_sales_orders:view', 'stores:view', 'promos:view', 'spg_sales:view', 'sales_orders:view', 'sales_returns:view', 'items:view')
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
  );

INSERT INTO "RoleDefinition" (id, name, description, "isSystem", "permissionsVersion", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'ADMIN_PAJAK', 'Tax admin — records tax-invoice numbers for billing notes and consignment', false, 1, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "RoleDefinition" WHERE name = 'ADMIN_PAJAK');

INSERT INTO "RolePermission" (id, "roleId", "permissionId")
SELECT gen_random_uuid()::text, r.id, p.id
FROM "RoleDefinition" r
CROSS JOIN "Permission" p
WHERE r.name = 'ADMIN_PAJAK'
  AND p.code IN ('dashboard:view', 'tax_invoices:view', 'tax_invoices:manage', 'consignment:view', 'consignment:tax_number')
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
  );

-- Keterangan lama (versi Max) diganti hanya bila masih persis seperti yang ditulis versi lama berkas
-- ini, supaya keterangan yang sudah diubah pemilik tetap bertahan.
UPDATE "RoleDefinition"
SET description = 'Finance — verifies payments against the bank statement, journals and financial reports', "updatedAt" = now()
WHERE name = 'KEUANGAN'
  AND description = 'Keuangan — verifikasi BKM ke mutasi rekening, jurnal, laporan keuangan, pembayaran pemasok';

UPDATE "RoleDefinition"
SET description = 'Sales admin — records the sales-note number on consignment cycles', "updatedAt" = now()
WHERE name = 'ADMIN_PENJUALAN'
  AND description = 'Admin penjualan — setujui pesanan lapangan, toko, promo, piutang & konsinyasi';

UPDATE "RoleDefinition"
SET description = 'Tax admin — records tax-invoice numbers for billing notes and consignment', "updatedAt" = now()
WHERE name = 'ADMIN_PAJAK'
  AND description = 'Admin pajak — nomor faktur pajak untuk nota tagihan dan konsinyasi';

-- Pengguna yang sudah masuk dengan salah satu peran ini langsung mendapat izin barunya.
UPDATE "RoleDefinition"
SET "permissionsVersion" = "permissionsVersion" + 1
WHERE name IN ('KEUANGAN', 'ADMIN_PENJUALAN', 'ADMIN_PAJAK');

COMMIT;

-- Cek: tiga baris, semuanya isSystem = false.
SELECT name, "isSystem", "permissionsVersion" FROM "RoleDefinition"
WHERE name IN ('KEUANGAN', 'ADMIN_PENJUALAN', 'ADMIN_PAJAK')
ORDER BY name;

-- Cek: izin persetujuan atau izin kelola yang lebar pada ketiga peran ini. Bawaannya KOSONG; baris
-- yang muncul ditambahkan pemilik di layar (biarkan) atau ditulis versi lama berkas ini (cabut di
-- Pengaturan → Peran & izin bila tidak dikehendaki).
SELECT r.name AS peran, p.code AS izin
FROM "RoleDefinition" r
JOIN "RolePermission" rp ON rp."roleId" = r.id
JOIN "Permission" p ON p.id = rp."permissionId"
WHERE r.name IN ('KEUANGAN', 'ADMIN_PENJUALAN', 'ADMIN_PAJAK')
  AND p.code IN ('receivables:decide_bearer', 'consignment:lock', 'store_stocktakes:approve',
                 'store_transfers:approve', 'store_transfers:decide_shortfall', 'spg_commission:pay',
                 'field_sales_orders:approve', 'field_sales_orders:credit_override', 'purchase_orders:approve',
                 'suppliers:approve', 'inventory_opname:approve', 'sales_returns:decide', 'field_returns:writeoff',
                 'receivables:manage', 'consignment:manage', 'stores:manage', 'promos:manage', 'payments:manage')
ORDER BY r.name, p.code;
