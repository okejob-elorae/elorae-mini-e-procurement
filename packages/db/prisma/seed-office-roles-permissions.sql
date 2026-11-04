-- Peran kerja kantor: KEUANGAN, ADMIN_PENJUALAN, ADMIN_PAJAK (MariaDB). Keputusan pemilik
-- 2026-11-01 (8): ketiganya dibuat, BUKAN admin, dan izinnya dipecah halus supaya pemilik bisa
-- mengatur sendiri di Pengaturan → Peran & izin — termasuk izin persetujuan.
--
--   mariadb --skip-ssl -u<user> -p <db> < seed-office-roles-permissions.sql
--
-- Urutan: jalankan SESUDAH seed-max-features-permissions.sql (izin piutang, konsinyasi, dan izin
-- hasil pemecahan 2026-11-01), seed-owner-2026-11-02-permissions.sql (spg_returns:approve),
-- seed-owner-2026-11-02b-permissions.sql (deliveries:cancel_nota, receivables:overdue_reminder,
-- spg_attendance:record, spg_attendance:verify), seed-tax-invoice-permissions.sql, dan
-- seed-finance-reports-permissions.sql. Berkas ini hanya
-- MENAUTKAN izin yang sudah ada; kalau satu
-- saja belum ada, pemeriksaan pertama di bawah menghentikan berkas (ERROR 1242) SEBELUM menulis apa
-- pun — dulu tautannya terlewat diam-diam. Klien mariadb berhenti di galat pertama; jangan pakai
-- --force. Untuk melihat izin mana yang belum ada:
--   SELECT code FROM Permission WHERE code IN (<daftar di pemeriksaan>) ORDER BY code;
--
-- isSystem = 0 SELALU. Peran sistem mendapat wildcard '*' di kode (apps/web/lib/auth/segarkan-sesi.ts),
-- jadi 1 di sini = admin penuh. Kalau peran bernama sama sudah ada sebagai peran sistem, pemeriksaan
-- pertama juga menghentikan berkas — tidak diturunkan diam-diam.
--
-- Isi bawaan: pekerjaan yang menjadi alasan peran itu ada, ditambah izin lihat yang dibutuhkannya.
-- TIDAK ADA izin persetujuan (kunci angka konsi, beban selisih, opname toko, mutasi antar toko,
-- setujui pesanan, dst.) — bawaannya hanya admin; pemilik memberikannya sendiri — kecuali dua yang
-- diputuskan pemilik 2026-11-02 (PERSETUJUAN_BAWAAN_PERAN_KANTOR di penjelasan-izin.ts):
-- spg_returns:approve untuk ADMIN_PENJUALAN (retur pembeli SPG disetujui admin dan admin penjualan)
-- dan spg_commission:pay untuk KEUANGAN (Q9: Keuangan menandai gaji & komisi SPG dibayar — dari
-- halaman Komisi SPG saja, TANPA spg_sales:view, jadi tidak membuka layar SPG lain, P28).
--   KEUANGAN        — periksa pembayaran (BKM, giro) ke mutasi bank, jurnal, laporan keuangan,
--                     pembayaran pemasok, bayar gaji & komisi SPG, menerima pengingat jatuh tempo
--                     (receivables:overdue_reminder, P48), dan memeriksa catatan check-in toko SPG
--                     (spg_attendance:verify, P61a). Tidak mencatat BKM (tidak memegang
--                     receivables:manage), jadi tidak pernah memeriksa catatannya sendiri; penulisnya
--                     pun menolak itu.
--   ADMIN_PENJUALAN — nomor nota di siklus konsinyasi, persetujuan retur pembeli SPG, membatalkan
--                     pengiriman yang sudah bernota (deliveries:cancel_nota, P41a), dan memasukkan
--                     catatan check-in toko SPG (spg_attendance:record, P7e), ditambah izin lihat
--                     penjualan.
--   ADMIN_PAJAK     — nomor faktur pajak: antrean nota tagihan dan siklus konsinyasi.
--
-- Idempoten — aman dijalankan ulang. Tautan bawaan tiap peran hanya ditulis pada run yang MEMBUAT
-- peran itu (penandanya ditangkap sebelum INSERT, seperti di seed-owner-2026-11-02b-permissions.sql),
-- jadi menjalankan ulang tidak pernah mengembalikan izin yang sudah dicabut pemilik di Peran & izin
-- (keputusan pemilik 2026-11-01 (8): pemilik mengatur izin sendiri). Peran yang SUDAH ADA menerima
-- kode baru hanya lewat berkas seed bertanggal yang membuat kode itu — tautan bawaan baru untuk peran
-- kantor ditulis juga DI SANA (pola 2b), bukan hanya dengan menambah daftar di sini.
-- Menjalankan ulang juga tidak mencabut izin yang ditambahkan pemilik di layar, dan tidak mencabut
-- tautan yang ditulis versi lama berkas ini (versi Max memberi ADMIN_PENJUALAN beberapa persetujuan):
-- pemeriksaan terakhir menampilkannya untuk dicabut di layar.
-- Keterangan peran sama persis dengan DESKRIPSI_PERAN_BAWAAN (apps/web/lib/rbac/penjelasan-izin.ts)
-- supaya layar menerjemahkannya; daftar izinnya sama dengan seed.ts
-- (apps/web/lib/rbac/peran-kantor.test.ts membandingkan keduanya).

SELECT IF(
  (SELECT COUNT(*) FROM Permission WHERE code IN (
    'dashboard:view', 'journals:view', 'journals:manage', 'coa:view', 'finance_reports:view',
    'payments:verify', 'receivables:view', 'tax_invoices:view', 'tax_invoices:manage',
    'supplier_payments:view', 'supplier_payments:create', 'supplier_payments:edit', 'purchase_orders:view',
    'consignment:view', 'consignment:note_number', 'consignment:tax_number', 'sales_orders:view',
    'field_sales_orders:view', 'stores:view', 'promos:view', 'spg_sales:view', 'sales_returns:view',
    'items:view', 'spg_returns:approve', 'spg_commission:pay', 'receivables:overdue_reminder',
    'spg_attendance:verify', 'deliveries:cancel_nota', 'spg_attendance:record'
  )) = 29
  AND NOT EXISTS (
    SELECT 1 FROM RoleDefinition
    WHERE name IN ('KEUANGAN', 'ADMIN_PENJUALAN', 'ADMIN_PAJAK') AND isSystem <> 0
  ),
  'preflight ok',
  (SELECT 'ABORT: izin belum ada atau peran kantor bertanda sistem' UNION ALL SELECT 'ABORT')
) AS preflight;

START TRANSACTION;

-- Ditangkap SEBELUM perannya dibuat: tautan bawaan tiap peran hanya ditulis pada run yang membuatnya.
SET @keuangan_is_new = (SELECT COUNT(*) FROM RoleDefinition WHERE name = 'KEUANGAN') = 0;
SET @admin_penjualan_is_new = (SELECT COUNT(*) FROM RoleDefinition WHERE name = 'ADMIN_PENJUALAN') = 0;
SET @admin_pajak_is_new = (SELECT COUNT(*) FROM RoleDefinition WHERE name = 'ADMIN_PAJAK') = 0;

INSERT INTO RoleDefinition (id, name, description, isSystem, permissionsVersion, createdAt, updatedAt)
SELECT REPLACE(UUID(), '-', ''), 'KEUANGAN', 'Finance — verifies payments against the bank statement, journals and financial reports', 0, 1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM RoleDefinition WHERE name = 'KEUANGAN');

INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'KEUANGAN'
  AND p.code IN ('dashboard:view', 'journals:view', 'journals:manage', 'coa:view', 'finance_reports:view', 'payments:verify', 'receivables:view', 'receivables:overdue_reminder', 'tax_invoices:view', 'supplier_payments:view', 'supplier_payments:create', 'supplier_payments:edit', 'purchase_orders:view', 'consignment:view', 'sales_orders:view', 'spg_commission:pay', 'spg_attendance:verify')
  AND @keuangan_is_new = 1
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );

INSERT INTO RoleDefinition (id, name, description, isSystem, permissionsVersion, createdAt, updatedAt)
SELECT REPLACE(UUID(), '-', ''), 'ADMIN_PENJUALAN', 'Sales admin — records the sales-note number on consignment cycles', 0, 1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM RoleDefinition WHERE name = 'ADMIN_PENJUALAN');

INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'ADMIN_PENJUALAN'
  AND p.code IN ('dashboard:view', 'consignment:view', 'consignment:note_number', 'field_sales_orders:view', 'stores:view', 'promos:view', 'spg_sales:view', 'sales_orders:view', 'sales_returns:view', 'items:view', 'spg_returns:approve', 'deliveries:cancel_nota', 'spg_attendance:record')
  AND @admin_penjualan_is_new = 1
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );

INSERT INTO RoleDefinition (id, name, description, isSystem, permissionsVersion, createdAt, updatedAt)
SELECT REPLACE(UUID(), '-', ''), 'ADMIN_PAJAK', 'Tax admin — records tax-invoice numbers for billing notes and consignment', 0, 1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM RoleDefinition WHERE name = 'ADMIN_PAJAK');

INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'ADMIN_PAJAK'
  AND p.code IN ('dashboard:view', 'tax_invoices:view', 'tax_invoices:manage', 'consignment:view', 'consignment:tax_number')
  AND @admin_pajak_is_new = 1
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );

-- Versi izin naik hanya untuk peran yang mendapat tautan pada run ini — yang baru dibuat — seperti
-- seed-owner-2026-11-02b-permissions.sql. Run ulang tidak menulis tautan, jadi tidak menaikkan apa pun.
UPDATE RoleDefinition
SET permissionsVersion = permissionsVersion + 1
WHERE (name = 'KEUANGAN' AND @keuangan_is_new = 1)
   OR (name = 'ADMIN_PENJUALAN' AND @admin_penjualan_is_new = 1)
   OR (name = 'ADMIN_PAJAK' AND @admin_pajak_is_new = 1);

COMMIT;

-- Cek: tiga baris, semuanya isSystem = 0.
SELECT name, isSystem, permissionsVersion FROM RoleDefinition
WHERE name IN ('KEUANGAN', 'ADMIN_PENJUALAN', 'ADMIN_PAJAK')
ORDER BY name;

-- Cek: izin persetujuan atau izin kelola yang lebar pada ketiga peran ini. Bawaannya KOSONG; baris
-- yang muncul ditambahkan pemilik di layar (biarkan) atau ditulis versi lama berkas ini (cabut di
-- Pengaturan → Peran & izin bila tidak dikehendaki). spg_returns:approve sengaja tidak dicantumkan:
-- ADMIN_PENJUALAN memegangnya secara bawaan. spg_commission:pay tetap dicantumkan untuk dua peran
-- lainnya, tetapi tidak dilaporkan pada KEUANGAN yang memegangnya secara bawaan.
SELECT r.name AS peran, p.code AS izin
FROM RoleDefinition r
JOIN RolePermission rp ON rp.roleId = r.id
JOIN Permission p ON p.id = rp.permissionId
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
