-- Peran kerja kantor siap pakai: KEUANGAN, ADMIN_PENJUALAN, ADMIN_PAJAK (MariaDB).
-- Idempoten — aman dijalankan ulang. Peran bukan sistem (isSystem = 0), jadi
-- tidak mewarisi izin penuh admin. Hanya izin yang SUDAH ADA di tabel Permission
-- yang ditautkan: jalankan SESUDAH seed receivables, consignment, tax_invoices dan
-- finance_reports. Izinnya bisa diubah pemilik di Pengaturan → Peran & Izin;
-- menjalankan ulang berkas ini tidak mencabut izin yang ditambahkan di sana.


INSERT INTO RoleDefinition (id, name, description, isSystem, permissionsVersion, createdAt, updatedAt)
SELECT REPLACE(UUID(), '-', ''), 'KEUANGAN', 'Keuangan — verifikasi BKM ke mutasi rekening, jurnal, laporan keuangan, pembayaran pemasok', 0, 1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM RoleDefinition WHERE name = 'KEUANGAN');

INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'KEUANGAN'
  AND p.code IN ('dashboard:view', 'journals:view', 'journals:manage', 'coa:view', 'finance_reports:view', 'receivables:view', 'tax_invoices:view', 'supplier_payments:view', 'supplier_payments:create', 'supplier_payments:edit', 'purchase_orders:view', 'consignment:view', 'sales_orders:view')
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );

INSERT INTO RoleDefinition (id, name, description, isSystem, permissionsVersion, createdAt, updatedAt)
SELECT REPLACE(UUID(), '-', ''), 'ADMIN_PENJUALAN', 'Admin penjualan — setujui pesanan lapangan, toko, promo, piutang & konsinyasi', 0, 1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM RoleDefinition WHERE name = 'ADMIN_PENJUALAN');

INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'ADMIN_PENJUALAN'
  AND p.code IN ('dashboard:view', 'field_sales_orders:view', 'field_sales_orders:approve', 'stores:view', 'stores:manage', 'promos:view', 'promos:manage', 'receivables:view', 'receivables:manage', 'consignment:view', 'consignment:manage', 'sales_orders:view', 'sales_returns:view', 'spg_sales:view', 'items:view')
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );

INSERT INTO RoleDefinition (id, name, description, isSystem, permissionsVersion, createdAt, updatedAt)
SELECT REPLACE(UUID(), '-', ''), 'ADMIN_PAJAK', 'Admin pajak — nomor faktur pajak untuk nota tagihan dan konsinyasi', 0, 1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM RoleDefinition WHERE name = 'ADMIN_PAJAK');

INSERT INTO RolePermission (id, roleId, permissionId)
SELECT REPLACE(UUID(), '-', ''), r.id, p.id
FROM RoleDefinition r
CROSS JOIN Permission p
WHERE r.name = 'ADMIN_PAJAK'
  AND p.code IN ('dashboard:view', 'tax_invoices:view', 'tax_invoices:manage', 'receivables:view', 'consignment:view', 'finance_reports:view')
  AND NOT EXISTS (
    SELECT 1 FROM RolePermission rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );
