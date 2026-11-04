-- Izin baru dari keputusan pemilik 2026-11-02 (PostgreSQL — basis data lokal saja). Salinan PostgreSQL
-- dari ../seed-owner-2026-11-02-permissions.sql; produksi (MariaDB) memakai berkas itu. Izin, peran,
-- dan urutan INSERT-nya wajib sama dengan berkas itu (packages/db/prisma/migrasi-mariadb.test.ts).
--
--   psql "<DATABASE_URL>" -v ON_ERROR_STOP=1 -f seed-owner-2026-11-02-permissions.sql
--
-- Di PostgreSQL kedua izin ini juga dibuat seed.ts (`pnpm -F @elorae/db seed`), lengkap dengan
-- tautannya; berkas ini untuk basis data yang di-seed sebelum 2026-11-02 dan tidak menjalankan seed.ts
-- ulang. Jalankan SEBELUM seed-office-roles-permissions.sql, yang berhenti sebelum menulis apa pun
-- kalau spg_returns:approve belum ada.
--
--   spg_returns:approve    — menyetujui atau menolak laporan retur pembeli yang dicatat SPG di konter.
--                            Persetujuan; bawaannya admin DAN ADMIN_PENJUALAN (keputusan pemilik 2026-11-02).
--   jubelio_prices:confirm — mengonfirmasi harga jual sebelum dikirim ke Jubelio. Persetujuan; bawaannya
--                            hanya admin.
--
-- Idempoten. Tautan ADMIN_PENJUALAN → spg_returns:approve hanya ditulis pada run yang MEMBUAT baris
-- spg_returns:approve, jadi menjalankan ulang tidak pernah mengembalikan izin yang sudah dicabut pemilik
-- di Peran & izin.

BEGIN;

-- Ditangkap SEBELUM barisnya dibuat; tabelnya hilang sendiri saat COMMIT.
CREATE TEMP TABLE izin_pemilik_2026_11_02 ON COMMIT DROP AS
SELECT NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = 'spg_returns:approve') AS spg_returns_baru;

INSERT INTO "Permission" (id, code, module, action, description)
SELECT gen_random_uuid()::text, 'spg_returns:approve', 'spg_returns', 'approve',
       'Approve or reject an SPG''s report of goods a shopper returned at the counter (manager decision, admin and sales admin by default)'
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = 'spg_returns:approve');

INSERT INTO "Permission" (id, code, module, action, description)
SELECT gen_random_uuid()::text, 'jubelio_prices:confirm', 'jubelio_prices', 'confirm',
       'Confirm selling prices before they are sent to Jubelio'
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = 'jubelio_prices:confirm');

-- ADMIN sudah lolos lewat wildcard di kode; tautannya dibuat supaya sama dengan seed.ts.
INSERT INTO "RolePermission" (id, "roleId", "permissionId")
SELECT gen_random_uuid()::text, r.id, p.id
FROM "RoleDefinition" r
CROSS JOIN "Permission" p
WHERE r.name = 'ADMIN'
  AND p.code IN ('spg_returns:approve', 'jubelio_prices:confirm')
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
  );

-- Bawaan pemilik, SEKALI: ADMIN_PENJUALAN yang sudah ada ikut menyetujui retur pembeli SPG.
INSERT INTO "RolePermission" (id, "roleId", "permissionId")
SELECT gen_random_uuid()::text, r.id, p.id
FROM "RoleDefinition" r
CROSS JOIN "Permission" p
WHERE r.name = 'ADMIN_PENJUALAN'
  AND p.code = 'spg_returns:approve'
  AND (SELECT spg_returns_baru FROM izin_pemilik_2026_11_02)
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
  );

-- Pengguna ADMIN_PENJUALAN yang sudah masuk langsung mendapat izin barunya.
UPDATE "RoleDefinition"
SET "permissionsVersion" = "permissionsVersion" + 1
WHERE name = 'ADMIN_PENJUALAN'
  AND (SELECT spg_returns_baru FROM izin_pemilik_2026_11_02);

COMMIT;

-- Cek: dua baris.
SELECT code, description FROM "Permission"
WHERE code IN ('spg_returns:approve', 'jubelio_prices:confirm')
ORDER BY code;

-- Cek: peran yang memegang kedua izin ini.
SELECT r.name AS peran, p.code AS izin
FROM "RoleDefinition" r
JOIN "RolePermission" rp ON rp."roleId" = r.id
JOIN "Permission" p ON p.id = rp."permissionId"
WHERE p.code IN ('spg_returns:approve', 'jubelio_prices:confirm')
ORDER BY p.code, r.name;
