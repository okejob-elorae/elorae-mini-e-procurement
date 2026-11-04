-- Komisi SPG satu hitungan (keputusan pemilik 2026-11-01): tarif per kategori barang × potong
-- yang dijual masing-masing SPG (apps/web/lib/spg-commission/payout.ts), dibayar di bulan
-- laporannya dicek, dengan catatan bulan penjualannya.
--
-- SpgSalesCheck: "Tandai laporan dicek" untuk penjualan SPG satu toko putus × satu bulan WIB.
-- Bulan WIB `checkedAt` = bulan pembayarannya. Satu baris per toko × bulan; batal dicek menghapus
-- barisnya (hanya selama komisi toko × bulan itu belum ada yang dibayar), jejak audit menyimpan isinya.
--
-- SpgCommissionRate: tarif komisi per kategori yang dipakai hitungan itu. Tabel ini sudah ada di
-- MariaDB (20261021110000_spg_commission_rate) tetapi belum pernah ada di sisi PostgreSQL.
--
-- Tanpa FOREIGN KEY (relationMode = "prisma"), tanpa isian awal, aman dijalankan ulang.

CREATE TABLE IF NOT EXISTS "SpgSalesCheck" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "period" VARCHAR(7) NOT NULL,
  "checkedById" TEXT NOT NULL,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpgSalesCheck_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SpgSalesCheck_storeId_period_key" ON "SpgSalesCheck"("storeId", "period");
CREATE INDEX IF NOT EXISTS "SpgSalesCheck_checkedAt_idx" ON "SpgSalesCheck"("checkedAt");

CREATE TABLE IF NOT EXISTS "SpgCommissionRate" (
  "id" TEXT NOT NULL,
  "itemCategoryId" TEXT NOT NULL,
  "amountPerPiece" DECIMAL(15,2) NOT NULL,
  "effectiveFrom" VARCHAR(7) NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SpgCommissionRate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SpgCommissionRate_itemCategoryId_effectiveFrom_key" ON "SpgCommissionRate"("itemCategoryId", "effectiveFrom");

-- ConsignmentCommission.salaried: baris gaji siklus milik peserta bergaji pokok (SPG yang bertugas
-- di toko itu saat kunci pertama) atau hanya penjual dari toko lain, yang mendapat komisi dari
-- penjualannya sendiri tanpa gaji pokok. Mengunci ulang sesudah buka kunci mempertahankan tandanya,
-- jadi penjual dari toko lain tidak pernah berubah menjadi peserta bergaji. Baris yang sudah ada
-- semuanya dibuat untuk SPG yang bertugas (aturan lama), karena itu bawaannya true.
ALTER TABLE "ConsignmentCommission" ADD COLUMN IF NOT EXISTS "salaried" BOOLEAN NOT NULL DEFAULT true;
