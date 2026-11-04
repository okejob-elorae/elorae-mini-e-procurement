-- Peran kerja kantor: KEUANGAN, ADMIN_PENJUALAN, ADMIN_PAJAK (PostgreSQL — basis data lokal saja).
-- Salinan PostgreSQL dari ../seed-office-roles-permissions.sql; produksi (MariaDB) memakai berkas itu.
-- Daftar izin tiap peran, keterangan peran, dan isSystem = false WAJIB sama persis dengan berkas itu
-- dan dengan seed.ts — apps/web/lib/rbac/peran-kantor.test.ts membandingkan ketiganya.
--
--   psql "<DATABASE_URL>" -v ON_ERROR_STOP=1 -f seed-office-roles-permissions.sql
--
-- Urutan: jalankan SESUDAH seed.ts (`pnpm -F @elorae/db seed`) — atau, pada basis data yang di-seed
-- sebelum 2026-11-02, sesudah postgres/seed-owner-2026-11-02-permissions.sql (spg_returns:approve) dan
-- postgres/seed-owner-2026-11-02b-permissions.sql (deliveries:cancel_nota, receivables:overdue_reminder,
-- spg_attendance:record, spg_attendance:verify).
-- Berkas ini hanya MENAUTKAN izin yang sudah ada, dan di PostgreSQL izin hasil pemecahan 2026-11-01
-- (payments:verify, consignment:note_number, consignment:tax_number, …) hanya dibuat seed.ts. Kalau satu saja belum
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
-- memberikannya sendiri di Pengaturan → Peran & izin — kecuali dua yang diputuskan pemilik 2026-11-02
-- (PERSETUJUAN_BAWAAN_PERAN_KANTOR di penjelasan-izin.ts): spg_returns:approve untuk ADMIN_PENJUALAN
-- (retur pembeli SPG disetujui admin dan admin penjualan) dan spg_commission:pay untuk KEUANGAN (Q9,
-- dari halaman Komisi SPG saja, TANPA spg_sales:view, P28).
--   KEUANGAN        — periksa pembayaran (BKM, giro) ke mutasi bank, jurnal, laporan keuangan,
--                     pembayaran pemasok, bayar gaji & komisi SPG, menerima pengingat jatuh tempo
--                     (receivables:overdue_reminder, P48), dan memeriksa catatan check-in toko SPG
--                     (spg_attendance:verify, P61a). Tidak mencatat BKM (tidak memegang
--                     receivables:manage).
--   ADMIN_PENJUALAN — nomor nota di siklus konsinyasi, persetujuan retur pembeli SPG, membatalkan
--                     pengiriman yang sudah bernota (deliveries:cancel_nota, P41a), dan memasukkan
--                     catatan check-in toko SPG (spg_attendance:record, P7e), ditambah izin lihat
--                     penjualan.
--   ADMIN_PAJAK     — nomor faktur pajak: antrean nota tagihan dan siklus konsinyasi.
--
-- Idempoten — aman dijalankan ulang. Tautan bawaan tiap peran hanya ditulis pada run yang MEMBUAT
-- peran itu (penandanya ditangkap sebelum INSERT, seperti di postgres/seed-owner-2026-11-02b-permissions.sql),
-- jadi menjalankan ulang tidak pernah mengembalikan izin yang sudah dicabut pemilik di Peran & izin
-- (keputusan pemilik 2026-11-01 (8)). Peran yang SUDAH ADA menerima kode baru hanya lewat seed.ts atau
-- berkas seed bertanggal yang membuat kode itu.
-- Menjalankan ulang juga tidak mencabut izin yang ditambahkan pemilik di layar, dan tidak mencabut
-- tautan yang ditulis versi lama berkas ini (versi lama memberi
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
      'items:view', 'spg_returns:approve', 'spg_commission:pay', 'receivables:overdue_reminder',
      'spg_attendance:verify', 'deliveries:cancel_nota', 'spg_attendance:record'
    )
  ) <> 29
  OR EXISTS (
    SELECT 1 FROM "RoleDefinition"
    WHERE name IN ('KEUANGAN', 'ADMIN_PENJUALAN', 'ADMIN_PAJAK') AND "isSystem"
  ) THEN
    RAISE EXCEPTION 'ABORT: izin belum ada atau peran kantor bertanda sistem';
  END IF;
END $$;

-- Ditangkap SEBELUM perannya dibuat: tautan bawaan tiap peran hanya ditulis pada run yang membuatnya.
-- Tabelnya hilang sendiri saat COMMIT.
CREATE TEMP TABLE peran_kantor_baru ON COMMIT DROP AS
SELECT
  NOT EXISTS (SELECT 1 FROM "RoleDefinition" WHERE name = 'KEUANGAN') AS keuangan_baru,
  NOT EXISTS (SELECT 1 FROM "RoleDefinition" WHERE name = 'ADMIN_PENJUALAN') AS admin_penjualan_baru,
  NOT EXISTS (SELECT 1 FROM "RoleDefinition" WHERE name = 'ADMIN_PAJAK') AS admin_pajak_baru;

INSERT INTO "RoleDefinition" (id, name, description, "isSystem", "permissionsVersion", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'KEUANGAN', 'Finance — verifies payments against the bank statement, journals and financial reports', false, 1, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "RoleDefinition" WHERE name = 'KEUANGAN');

INSERT INTO "RolePermission" (id, "roleId", "permissionId")
SELECT gen_random_uuid()::text, r.id, p.id
FROM "RoleDefinition" r
CROSS JOIN "Permission" p
WHERE r.name = 'KEUANGAN'
  AND p.code IN ('dashboard:view', 'journals:view', 'journals:manage', 'coa:view', 'finance_reports:view', 'payments:verify', 'receivables:view', 'receivables:overdue_reminder', 'tax_invoices:view', 'supplier_payments:view', 'supplier_payments:create', 'supplier_payments:edit', 'purchase_orders:view', 'consignment:view', 'sales_orders:view', 'spg_commission:pay', 'spg_attendance:verify')
  AND (SELECT keuangan_baru FROM peran_kantor_baru)
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
  AND p.code IN ('dashboard:view', 'consignment:view', 'consignment:note_number', 'field_sales_orders:view', 'stores:view', 'promos:view', 'spg_sales:view', 'sales_orders:view', 'sales_returns:view', 'items:view', 'spg_returns:approve', 'deliveries:cancel_nota', 'spg_attendance:record')
  AND (SELECT admin_penjualan_baru FROM peran_kantor_baru)
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
  AND (SELECT admin_pajak_baru FROM peran_kantor_baru)
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

-- Versi izin naik hanya untuk peran yang mendapat tautan pada run ini — yang baru dibuat. Run ulang
-- tidak menulis tautan, jadi tidak menaikkan apa pun.
UPDATE "RoleDefinition"
SET "permissionsVersion" = "permissionsVersion" + 1
WHERE (name = 'KEUANGAN' AND (SELECT keuangan_baru FROM peran_kantor_baru))
   OR (name = 'ADMIN_PENJUALAN' AND (SELECT admin_penjualan_baru FROM peran_kantor_baru))
   OR (name = 'ADMIN_PAJAK' AND (SELECT admin_pajak_baru FROM peran_kantor_baru));

COMMIT;

-- Cek: tiga baris, semuanya isSystem = false.
SELECT name, "isSystem", "permissionsVersion" FROM "RoleDefinition"
WHERE name IN ('KEUANGAN', 'ADMIN_PENJUALAN', 'ADMIN_PAJAK')
ORDER BY name;

-- Cek: izin persetujuan atau izin kelola yang lebar pada ketiga peran ini. Bawaannya KOSONG; baris
-- yang muncul ditambahkan pemilik di layar (biarkan) atau ditulis versi lama berkas ini (cabut di
-- Pengaturan → Peran & izin bila tidak dikehendaki). spg_returns:approve sengaja tidak dicantumkan:
-- ADMIN_PENJUALAN memegangnya secara bawaan. spg_commission:pay tetap dicantumkan untuk dua peran
-- lainnya, tetapi tidak dilaporkan pada KEUANGAN yang memegangnya secara bawaan.
SELECT r.name AS peran, p.code AS izin
FROM "RoleDefinition" r
JOIN "RolePermission" rp ON rp."roleId" = r.id
JOIN "Permission" p ON p.id = rp."permissionId"
WHERE r.name IN ('KEUANGAN', 'ADMIN_PENJUALAN', 'ADMIN_PAJAK')
  AND p.code IN ('receivables:decide_bearer', 'consignment:lock', 'store_stocktakes:approve',
                 'store_transfers:approve', 'store_transfers:decide_shortfall', 'spg_commission:pay',
                 'field_sales_orders:approve', 'field_sales_orders:credit_override', 'purchase_orders:approve',
                 'suppliers:approve', 'inventory_opname:approve', 'sales_returns:decide', 'field_returns:writeoff',
                 'receivables:manage', 'consignment:manage', 'stores:manage', 'promos:manage', 'payments:manage',
                 'jubelio_prices:confirm', 'store_returns:decide_shortfall', 'vendor_bills:decide_price',
                 'goods_receipts:confirm_no_po', 'spg_schedules:approve')
  AND NOT (r.name = 'KEUANGAN' AND p.code = 'spg_commission:pay')
ORDER BY r.name, p.code;
