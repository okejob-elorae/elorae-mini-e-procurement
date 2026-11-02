-- Perbaikan data sisa keputusan pemilik 2026-11-01. Tanpa perubahan skema; boleh dijalankan ulang.
--
-- Kolom peran lama (`User.role`) diselaraskan dengan peran barunya (keputusan pemilik 7a), persis
-- `peranLamaDari` (apps/web/lib/users/peran-lama.ts): peran sistem -> ADMIN; peran bernama persis
-- PURCHASER / WAREHOUSE / PRODUCTION -> nama itu (peka huruf besar-kecil); selebihnya, tanpa peran,
-- atau roleId yang menggantung -> USER. Sebelum 2026-11-01 Pengaturan -> Pengguna mengisi `roleId`
-- tanpa kolom ini, jadi orang yang diangkat atau diturunkan di sana tertinggal nilai lama.
--
-- Penjual piutang (`Receivable.salesmanId`) TIDAK diisi ulang di sini, berbeda dengan pohon MariaDB
-- (20261102130000_residual_fixes): di pohon ini kolom itu ada sejak tabelnya dibuat
-- (1_piutang_pelunasan) dan penulis piutang pengiriman (`buatPiutangNota`) selalu mengisinya.

UPDATE "User" u SET "role" = COALESCE((
  SELECT CASE
    WHEN r."isSystem" THEN 'ADMIN'
    WHEN r."name" IN ('PURCHASER', 'WAREHOUSE', 'PRODUCTION') THEN r."name"
    ELSE 'USER'
  END
  FROM "RoleDefinition" r
  WHERE r."id" = u."roleId"
), 'USER')::"Role";
