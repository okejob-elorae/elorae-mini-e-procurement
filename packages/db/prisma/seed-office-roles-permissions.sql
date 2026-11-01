-- Peran kerja kantor: KEUANGAN, ADMIN_PENJUALAN, ADMIN_PAJAK (MariaDB). Keputusan pemilik
-- 2026-11-01 (8): ketiganya dibuat, BUKAN admin, dan izinnya dipecah halus supaya pemilik bisa
-- mengatur sendiri di Pengaturan → Peran & izin — termasuk izin persetujuan.
--
--   mariadb --skip-ssl -u<user> -p <db> < seed-office-roles-permissions.sql
--
-- Urutan: jalankan SESUDAH seed-max-features-permissions.sql (izin piutang, konsinyasi, dan izin
-- hasil pemecahan 2026-11-01), seed-tax-invoice-permissions.sql, dan
-- seed-finance-reports-permissions.sql. Berkas ini hanya MENAUTKAN izin yang sudah ada; kalau satu
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
-- bayar gaji SPG, setujui pesanan, dst.) — bawaannya hanya admin; pemilik memberikannya sendiri.
--   KEUANGAN        — periksa pembayaran (BKM, giro) ke mutasi bank, jurnal, laporan keuangan,
--                     pembayaran pemasok. Tidak mencatat BKM (tidak memegang receivables:manage),
--                     jadi tidak pernah memeriksa catatannya sendiri; penulisnya pun menolak itu.
--   ADMIN_PENJUALAN — nomor nota di siklus konsinyasi, ditambah izin lihat penjualan.
--   ADMIN_PAJAK     — nomor faktur pajak: antrean nota tagihan dan siklus konsinyasi.
--
-- Idempoten — aman dijalankan ulang. Menjalankan ulang tidak mencabut izin yang ditambahkan pemilik
-- di layar, dan juga tidak mencabut tautan yang ditulis versi lama berkas ini (versi Max memberi
-- ADMIN_PENJUALAN beberapa persetujuan): pemeriksaan terakhir menampilkannya untuk dicabut di layar.
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
    'items:view'
  )) = 23
  AND NOT EXISTS (
    SELECT 1 FROM RoleDefinition
    WHERE name IN ('KEUANGAN', 'ADMIN_PENJUALAN', 'ADMIN_PAJAK') AND isSystem <> 0
  ),
  'preflight ok',
  (SELECT 'ABORT: izin belum ada atau peran kantor bertanda sistem' UNION ALL SELECT 'ABORT')
) AS preflight;

START TRANSACTION;

INSERT INTO RoleDefinition (id, name, description, isSystem, permissionsVersion, createdAt, updatedAt)
SELECT REPLACE(UUID(), '-', ''), 'KEUANGAN', 'Finance — verifies payments against the bank statement, journals and financial reports', 0, 1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM RoleDefinition WHERE name = 'KEUANGAN');

INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'KEUANGAN'
  AND p.code IN ('dashboard:view', 'journals:view', 'journals:manage', 'coa:view', 'finance_reports:view', 'payments:verify', 'receivables:view', 'tax_invoices:view', 'supplier_payments:view', 'supplier_payments:create', 'supplier_payments:edit', 'purchase_orders:view', 'consignment:view', 'sales_orders:view')
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
  AND p.code IN ('dashboard:view', 'consignment:view', 'consignment:note_number', 'field_sales_orders:view', 'stores:view', 'promos:view', 'spg_sales:view', 'sales_orders:view', 'sales_returns:view', 'items:view')
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
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );

-- Pengguna yang sudah masuk dengan salah satu peran ini langsung mendapat izin barunya.
UPDATE RoleDefinition
SET permissionsVersion = permissionsVersion + 1
WHERE name IN ('KEUANGAN', 'ADMIN_PENJUALAN', 'ADMIN_PAJAK');

COMMIT;

-- Cek: tiga baris, semuanya isSystem = 0.
SELECT name, isSystem, permissionsVersion FROM RoleDefinition
WHERE name IN ('KEUANGAN', 'ADMIN_PENJUALAN', 'ADMIN_PAJAK')
ORDER BY name;

-- Cek: izin persetujuan atau izin kelola yang lebar pada ketiga peran ini. Bawaannya KOSONG; baris
-- yang muncul ditambahkan pemilik di layar (biarkan) atau ditulis versi lama berkas ini (cabut di
-- Pengaturan → Peran & izin bila tidak dikehendaki).
SELECT r.name AS peran, p.code AS izin
FROM RoleDefinition r
JOIN RolePermission rp ON rp.roleId = r.id
JOIN Permission p ON p.id = rp.permissionId
WHERE r.name IN ('KEUANGAN', 'ADMIN_PENJUALAN', 'ADMIN_PAJAK')
  AND p.code IN ('receivables:decide_bearer', 'consignment:lock', 'store_stocktakes:approve',
                 'store_transfers:approve', 'store_transfers:decide_shortfall', 'spg_commission:pay',
                 'field_sales_orders:approve', 'field_sales_orders:credit_override', 'purchase_orders:approve',
                 'suppliers:approve', 'inventory_opname:approve', 'sales_returns:decide', 'field_returns:writeoff',
                 'receivables:manage', 'consignment:manage', 'stores:manage', 'promos:manage', 'payments:manage')
ORDER BY r.name, p.code;
