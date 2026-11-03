-- Izin baru dari jawaban pemilik putaran 4 (2026-11-02 malam, P22–P88) — PostgreSQL, basis data lokal
-- saja. Salinan PostgreSQL dari ../seed-owner-2026-11-02b-permissions.sql; produksi (MariaDB) memakai
-- berkas itu. Izin, peran, dan urutan INSERT-nya wajib sama dengan berkas itu
-- (packages/db/prisma/migrasi-mariadb.test.ts).
--
--   psql "<DATABASE_URL>" -v ON_ERROR_STOP=1 -f seed-owner-2026-11-02b-permissions.sql
--
-- Di PostgreSQL izin ini juga dibuat seed.ts (`pnpm -F @elorae/db seed`), lengkap dengan tautannya;
-- berkas ini untuk basis data yang di-seed sebelum putaran 4 dan tidak menjalankan seed.ts ulang.
-- Jalankan SEBELUM seed-office-roles-permissions.sql, yang berhenti sebelum menulis apa pun kalau
-- deliveries:cancel_nota, receivables:overdue_reminder, spg_attendance:record, atau
-- spg_attendance:verify belum ada.
--
-- Izin persetujuan (bawaannya hanya admin):
--   store_returns:decide_shortfall — siapa menanggung selisih retur toko (dipecah dari
--                                    receivables:decide_bearer, yang kini hanya barang hilang, P22).
--   vendor_bills:decide_price      — selisih harga invoice pemasok vs utang tercatat (P27, P53).
--   goods_receipts:confirm_no_po   — konfirmasi penerimaan barang tanpa PO (P51a).
--   spg_schedules:approve          — jadwal bulanan SPG (P7c).
-- Izin kerja kantor dengan peran bawaan yang diputuskan pemilik:
--   deliveries:cancel_nota         — ADMIN_PENJUALAN (P41a).
--   receivables:overdue_reminder   — KEUANGAN (P48).
--   spg_attendance:record          — ADMIN_PENJUALAN (P7e).
--   spg_attendance:verify          — KEUANGAN (P61a).
-- Dan KEUANGAN → spg_commission:pay (Q9; halaman Komisi SPG saja, tanpa spg_sales:view, P28).
--
-- Idempoten. Tautan bawaan untuk peran yang sudah ada dan pewarisan receivables:decide_bearer →
-- store_returns:decide_shortfall hanya ditulis pada run yang MEMBUAT baris izinnya, jadi menjalankan
-- ulang tidak pernah mengembalikan izin yang sudah dicabut pemilik di Peran & izin.

BEGIN;

-- Ditangkap SEBELUM barisnya dibuat; tabelnya hilang sendiri saat COMMIT.
CREATE TEMP TABLE izin_pemilik_2026_11_02b ON COMMIT DROP AS
SELECT
  NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = 'deliveries:cancel_nota') AS cancel_nota_baru,
  NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = 'receivables:overdue_reminder') AS overdue_reminder_baru,
  NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = 'store_returns:decide_shortfall') AS return_shortfall_baru,
  NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = 'spg_schedules:approve') AS spg_schedules_approve_baru,
  NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = 'spg_attendance:record') AS attendance_record_baru,
  NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = 'spg_attendance:verify') AS attendance_verify_baru;

INSERT INTO "Permission" (id, code, module, action, description)
SELECT gen_random_uuid()::text, 'deliveries:cancel_nota', 'deliveries', 'cancel_nota',
       'Cancel a putus shipment whose billing note is already issued: the note, its receivable and tax invoice are voided and Finance is notified'
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = 'deliveries:cancel_nota');

INSERT INTO "Permission" (id, code, module, action, description)
SELECT gen_random_uuid()::text, 'receivables:overdue_reminder', 'receivables', 'overdue_reminder',
       'Receive the office reminder when a store invoice passes an overdue threshold (receiving only)'
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = 'receivables:overdue_reminder');

INSERT INTO "Permission" (id, code, module, action, description)
SELECT gen_random_uuid()::text, 'store_returns:decide_shortfall', 'store_returns', 'decide_shortfall',
       'Decide or reassign who bears a store-return shortfall (manager decision)'
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = 'store_returns:decide_shortfall');

INSERT INTO "Permission" (id, code, module, action, description)
SELECT gen_random_uuid()::text, 'vendor_bills:decide_price', 'vendor_bills', 'decide_price',
       'Decide a supplier invoice whose price differs from the recorded payable: accept it or correct the invoice (manager decision)'
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = 'vendor_bills:decide_price');

INSERT INTO "Permission" (id, code, module, action, description)
SELECT gen_random_uuid()::text, 'goods_receipts:confirm_no_po', 'goods_receipts', 'confirm_no_po',
       'Confirm or decline a goods receipt recorded without a PO before it is processed (manager decision)'
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = 'goods_receipts:confirm_no_po');

INSERT INTO "Permission" (id, code, module, action, description)
SELECT gen_random_uuid()::text, 'spg_schedules:approve', 'spg_schedules', 'approve',
       'Approve, reject or reopen an SPG''s monthly work schedule (manager decision)'
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = 'spg_schedules:approve');

INSERT INTO "Permission" (id, code, module, action, description)
SELECT gen_random_uuid()::text, 'spg_attendance:record', 'spg_attendance', 'record',
       'Enter an SPG''s store check-in record for a month, typed or from an Excel file'
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = 'spg_attendance:record');

INSERT INTO "Permission" (id, code, module, action, description)
SELECT gen_random_uuid()::text, 'spg_attendance:verify', 'spg_attendance', 'verify',
       'Check an SPG store check-in record entered by someone else against the original'
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = 'spg_attendance:verify');

-- ADMIN sudah lolos lewat wildcard di kode; tautannya dibuat supaya sama dengan seed.ts.
INSERT INTO "RolePermission" (id, "roleId", "permissionId")
SELECT gen_random_uuid()::text, r.id, p.id
FROM "RoleDefinition" r
CROSS JOIN "Permission" p
WHERE r.name = 'ADMIN'
  AND p.code IN ('deliveries:cancel_nota', 'receivables:overdue_reminder', 'store_returns:decide_shortfall',
                 'vendor_bills:decide_price', 'goods_receipts:confirm_no_po', 'spg_schedules:approve',
                 'spg_attendance:record', 'spg_attendance:verify')
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
  );

-- Bawaan pemilik, SEKALI (P41a).
INSERT INTO "RolePermission" (id, "roleId", "permissionId")
SELECT gen_random_uuid()::text, r.id, p.id
FROM "RoleDefinition" r
CROSS JOIN "Permission" p
WHERE r.name = 'ADMIN_PENJUALAN'
  AND p.code = 'deliveries:cancel_nota'
  AND (SELECT cancel_nota_baru FROM izin_pemilik_2026_11_02b)
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
  );

-- Bawaan pemilik, SEKALI (P7e).
INSERT INTO "RolePermission" (id, "roleId", "permissionId")
SELECT gen_random_uuid()::text, r.id, p.id
FROM "RoleDefinition" r
CROSS JOIN "Permission" p
WHERE r.name = 'ADMIN_PENJUALAN'
  AND p.code = 'spg_attendance:record'
  AND (SELECT attendance_record_baru FROM izin_pemilik_2026_11_02b)
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
  );

-- Bawaan pemilik, SEKALI (P48).
INSERT INTO "RolePermission" (id, "roleId", "permissionId")
SELECT gen_random_uuid()::text, r.id, p.id
FROM "RoleDefinition" r
CROSS JOIN "Permission" p
WHERE r.name = 'KEUANGAN'
  AND p.code = 'receivables:overdue_reminder'
  AND (SELECT overdue_reminder_baru FROM izin_pemilik_2026_11_02b)
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
  );

-- Bawaan pemilik, SEKALI (P61a).
INSERT INTO "RolePermission" (id, "roleId", "permissionId")
SELECT gen_random_uuid()::text, r.id, p.id
FROM "RoleDefinition" r
CROSS JOIN "Permission" p
WHERE r.name = 'KEUANGAN'
  AND p.code = 'spg_attendance:verify'
  AND (SELECT attendance_verify_baru FROM izin_pemilik_2026_11_02b)
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
  );

-- Bawaan pemilik, SEKALI (Q9 + P28); penandanya run yang membuat spg_schedules:approve.
INSERT INTO "RolePermission" (id, "roleId", "permissionId")
SELECT gen_random_uuid()::text, r.id, p.id
FROM "RoleDefinition" r
CROSS JOIN "Permission" p
WHERE r.name = 'KEUANGAN'
  AND p.code = 'spg_commission:pay'
  AND (SELECT spg_schedules_approve_baru FROM izin_pemilik_2026_11_02b)
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
  );

-- Pewarisan, SEKALI (P22): setiap pemegang receivables:decide_bearer tetap memutuskan selisih retur toko.
INSERT INTO "RolePermission" (id, "roleId", "permissionId")
SELECT gen_random_uuid()::text, rp_ada."roleId", p.id
FROM "RolePermission" rp_ada
JOIN "Permission" p_ada ON p_ada.id = rp_ada."permissionId" AND p_ada.code = 'receivables:decide_bearer'
CROSS JOIN "Permission" p
WHERE p.code = 'store_returns:decide_shortfall'
  AND (SELECT return_shortfall_baru FROM izin_pemilik_2026_11_02b)
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp WHERE rp."roleId" = rp_ada."roleId" AND rp."permissionId" = p.id
  );

-- Keterangan bahasa Inggris receivables:decide_bearer menyempit ke barang hilang — hanya bila masih teks lama.
UPDATE "Permission"
SET description = 'Decide, change or cancel who bears lost goods, at an SPG store or in transit (manager decision)'
WHERE code = 'receivables:decide_bearer'
  AND description = 'Decide, reassign or cancel who bears a store-return shortfall or lost SPG goods (manager decision)';

-- Pengguna yang sudah masuk dengan peran yang mendapat tautan baru langsung mendapat izinnya.
UPDATE "RoleDefinition"
SET "permissionsVersion" = "permissionsVersion" + 1
WHERE (name = 'ADMIN_PENJUALAN'
       AND (SELECT cancel_nota_baru OR attendance_record_baru FROM izin_pemilik_2026_11_02b))
   OR (name = 'KEUANGAN'
       AND (SELECT overdue_reminder_baru OR attendance_verify_baru OR spg_schedules_approve_baru FROM izin_pemilik_2026_11_02b))
   OR ((SELECT return_shortfall_baru FROM izin_pemilik_2026_11_02b)
       AND id IN (
         SELECT rp."roleId" FROM "RolePermission" rp
         JOIN "Permission" p ON p.id = rp."permissionId"
         WHERE p.code = 'store_returns:decide_shortfall'
       ));

COMMIT;

-- Cek: delapan baris.
SELECT code, description FROM "Permission"
WHERE code IN ('deliveries:cancel_nota', 'receivables:overdue_reminder', 'store_returns:decide_shortfall',
               'vendor_bills:decide_price', 'goods_receipts:confirm_no_po', 'spg_schedules:approve',
               'spg_attendance:record', 'spg_attendance:verify')
ORDER BY code;

-- Cek: peran yang memegang izin baru ini (dan spg_commission:pay).
SELECT r.name AS peran, p.code AS izin
FROM "RoleDefinition" r
JOIN "RolePermission" rp ON rp."roleId" = r.id
JOIN "Permission" p ON p.id = rp."permissionId"
WHERE p.code IN ('deliveries:cancel_nota', 'receivables:overdue_reminder', 'store_returns:decide_shortfall',
                 'vendor_bills:decide_price', 'goods_receipts:confirm_no_po', 'spg_schedules:approve',
                 'spg_attendance:record', 'spg_attendance:verify', 'spg_commission:pay')
ORDER BY p.code, r.name;

-- Cek: pemegang receivables:decide_bearer yang belum memegang store_returns:decide_shortfall.
SELECT r.name AS peran
FROM "RoleDefinition" r
JOIN "RolePermission" rp ON rp."roleId" = r.id
JOIN "Permission" p ON p.id = rp."permissionId" AND p.code = 'receivables:decide_bearer'
WHERE NOT EXISTS (
  SELECT 1 FROM "RolePermission" rp2
  JOIN "Permission" p2 ON p2.id = rp2."permissionId" AND p2.code = 'store_returns:decide_shortfall'
  WHERE rp2."roleId" = r.id
)
ORDER BY r.name;
