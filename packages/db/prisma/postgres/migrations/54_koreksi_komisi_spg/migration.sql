-- SpgCommissionCorrection: koreksi komisi SPG yang DITERAPKAN pada sebuah pembayaran (keputusan
-- pemilik 2026-11-02). Komisi dihitung satu cara di mana pun (tarif kategori bulan penjualan x
-- potong bersih terkonfirmasi milik SPG itu sendiri, apps/web/lib/spg-commission/payout.ts); tidak
-- ada bagi rata. Baris yang belum dibayar dibayar dengan angka per SPG saat ini. Baris yang SUDAH
-- dibayar tidak pernah diubah: selisihnya (angka per SPG sekarang - yang dibayar - koreksi yang
-- sudah diterapkan dari laporan itu) ikut SEKALI di pembayaran SPG itu berikutnya sebagai baris
-- sendiri, mis. "Koreksi komisi penjualan September 2026 - Toko X: +Rp 17.500". Selisihnya
-- DITURUNKAN, tidak disimpan (apps/web/lib/spg/koreksi.ts); baris di sini baru ditulis saat
-- pembayaran yang membawanya ditandai dibayar, di transaksi yang sama, dengan baris jejaknya.
-- Baris tidak pernah diubah atau dihapus.
--
-- Kolom:
--   sourceKind        'KONSI' | 'PUTUS'
--   sourceKey         laporannya: 'konsi:<cycleId>' atau 'putus:<storeId>:<YYYY-MM>'
--   sourceStoreId,
--   sourceSalesMonth  toko dan bulan penjualan WIB laporan itu (toko + kanal jurnal, label)
--   amount            rupiah bertanda yang diterapkan pembayaran ini
--   difference        seluruh selisih saat diterapkan; berbeda dari amount hanya untuk koreksi minus
--                     yang dipotong supaya pembayaran tidak di bawah Rp 0 (sisanya tetap diturunkan
--                     dan ikut pembayaran sesudahnya)
--   figure, paidBefore,
--   appliedBefore     potret suku-suku rumusnya saat diterapkan
--   paidRefType       'SpgCommission' | 'ConsignmentCommission' (REF_KOMISI_* di lib/spg/hilang.ts)
--   paidRefId         baris yang dibayar yang membawa koreksi ini
--   payoutMonth       bulan pembayaran baris itu (WIB 'YYYY-MM')
--   note              'Koreksi komisi penjualan <bulan> - <toko>'
--
-- Satu baris per baris dibayar x laporan asal: kunci uniknya penjaga basis data agar satu laporan
-- tidak diterapkan dua kali pada satu pembayaran. Tanpa FOREIGN KEY: relationMode = "prisma".
--
-- Hanya menambah, sengaja tanpa isian ulang: pembayaran bagi rata lama, retur pembeli yang
-- disetujui sesudah dibayar, dan nota HP yang masuk sesudah dibayar muncul sebagai koreksi yang
-- menunggu (diturunkan) dan baru tertulis di sini saat pembayaran berikutnya SPG itu dibayar.
-- Image lama tetap jalan dengan skema ini (tidak membaca tabelnya). Boleh dijalankan ulang.

CREATE TABLE IF NOT EXISTS "SpgCommissionCorrection" (
  "id" TEXT NOT NULL,
  "spgUserId" TEXT NOT NULL,
  "sourceKind" VARCHAR(10) NOT NULL,
  "sourceKey" VARCHAR(191) NOT NULL,
  "sourceStoreId" TEXT NOT NULL,
  "sourceSalesMonth" VARCHAR(7) NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "difference" DECIMAL(15,2) NOT NULL,
  "figure" DECIMAL(15,2) NOT NULL,
  "paidBefore" DECIMAL(15,2) NOT NULL,
  "appliedBefore" DECIMAL(15,2) NOT NULL,
  "paidRefType" VARCHAR(40) NOT NULL,
  "paidRefId" TEXT NOT NULL,
  "payoutMonth" VARCHAR(7) NOT NULL,
  "note" TEXT NOT NULL,
  "appliedById" TEXT NOT NULL,
  "appliedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpgCommissionCorrection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SpgCommissionCorrection_paidRefType_paidRefId_sourceKey_key" ON "SpgCommissionCorrection"("paidRefType", "paidRefId", "sourceKey");
CREATE INDEX IF NOT EXISTS "SpgCommissionCorrection_spgUserId_sourceKey_idx" ON "SpgCommissionCorrection"("spgUserId", "sourceKey");
CREATE INDEX IF NOT EXISTS "SpgCommissionCorrection_payoutMonth_idx" ON "SpgCommissionCorrection"("payoutMonth");
