-- Barang hilang memotong gaji/komisi, dan penghitung pengunjung SPG (2026-10-03).
-- * `ConsignmentCommission.deduction` / `SpgCommission.deduction`: potongan beban
--   (barang hilang) yang dibekukan saat gaji/komisi dibayar.
-- * `StockLossShare.settledAmount` + `StockLossDeduction`: beban boleh dicicil
--   (batas potongan per pembayaran); setiap potongan tercatat dengan dokumen
--   pembayarannya, jadi sisa beban selalu bisa dijelaskan.
-- * `SpgVisitorCount`: jumlah pengunjung per SPG per toko per hari WIB. HP mengirim
--   angka MUTLAK beserta waktu ubahnya, jadi kiriman ulang dari antrean tanpa
--   sinyal tidak pernah menambah dua kali (yang lebih baru menang).
ALTER TABLE "ConsignmentCommission" ADD COLUMN     "deduction" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "SpgCommission" ADD COLUMN     "deduction" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "StockLossShare" ADD COLUMN     "settledAmount" DECIMAL(15,2) NOT NULL DEFAULT 0;
CREATE TABLE "SpgVisitorCount" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "clientUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SpgVisitorCount_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StockLossDeduction" (
    "id" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockLossDeduction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SpgVisitorCount_storeId_day_idx" ON "SpgVisitorCount"("storeId", "day");
CREATE UNIQUE INDEX "SpgVisitorCount_storeId_userId_day_key" ON "SpgVisitorCount"("storeId", "userId", "day");
CREATE INDEX "StockLossDeduction_shareId_idx" ON "StockLossDeduction"("shareId");
CREATE INDEX "StockLossDeduction_refType_refId_idx" ON "StockLossDeduction"("refType", "refId");
