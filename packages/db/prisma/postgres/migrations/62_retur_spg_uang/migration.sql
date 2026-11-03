-- Retur pembeli SPG: barang disisihkan, uang dikembalikan sesudah disetujui, dan beban SPG
-- (jawaban pemilik 2026-11-02: P12 "di sisihkan dahulu"; P13 uang hanya boleh dikembalikan sesudah
-- kantor menyetujui — kalau sudah dibayar sebelumnya itu salah SPG dan SPG yang mengganti; P13a SPG
-- melapor dengan uang BELUM dikembalikan, HP menyuruh mengembalikan sesudah disetujui; P14 foto
-- wajib; P77 foto barang saat melapor + foto struk setiap kali uangnya dikembalikan; P78 kantor
-- boleh menandai "uang ternyata sudah dikembalikan" saat menolak, alasan wajib; P79 sesudah SPG
-- mengganti, kantor memilih: uang SPG dikembalikan (barang masuk stok) atau barang dibeli SPG;
-- P80 tanpa kredit ke toko; P81 beban = harga bersih di nota SPG, kantor boleh memakai angka struk
-- dengan alasan; P82 penolakan keliru boleh dibatalkan dengan alasan selama belum ada yang dipotong;
-- P83 ditolak tanpa uang dikembalikan: barang dikembalikan ke pembeli). Penulis:
-- apps/web/lib/spg/retur-pembeli.ts dan apps/web/lib/spg/beban-spg-writer.ts.
--
-- SpgSaleReturn:
--   goodsPhotoR2Key: foto barang (wajib), `spg-sale-returns/<storeId>/<kunci laporan>/barang.<ext>`.
--   refundedAt: kapan kasir mengembalikan uang pembeli, menurut catatan SPG. NULL = belum, atau
--     hanya ditandai kantor (P78).
--   refundSlipR2Key: foto struk pengembalian, `.../struk.<ext>`; wajib setiap kali refundedAt terisi.
--   refundMarkedById / refundMarkReason: kantor menandai saat menolak bahwa uangnya ternyata sudah
--     dikembalikan (P78); refundedAt tetap NULL karena harinya tidak diketahui.
--   Isian bawaan status berubah dari 'DISETUJUI' menjadi 'MENUNGGU': status yang terlupa menjadi
--     laporan menunggu, tidak pernah laporan disetujui tanpa pengaruhnya. Bawaan lama adalah isian
--     ulang putaran 3; belum pernah ada penjualan atau retur SPG sungguhan, jadi tidak ada baris yang
--     bergantung padanya. Setiap penulis menyebut statusnya sendiri.
--   Indeks (storeId, refundedAt) melayani tutup hari: retur disetujui dihitung di hari uangnya kembali.
--
-- SpgCharge: satu per laporan ditolak yang uangnya sudah dikembalikan (source 'RETUR_PEMBELI',
-- sourceId = id laporan, unik). status TERBUKA | LUNAS (habis dipotong dari bayaran) | DIUTANGKAN
-- (sisanya dipindah ke utang SPG di pembayaran terakhirnya; baru lunas sesudah utang itu dibayar) |
-- BATAL (penolakan dibatalkan, P82). goodsDecision KEMBALI_STOK | DIBELI_SPG (P79, sekali).
-- paybackAmount = uang SPG yang dikembalikan di pembayaran berikutnya sesudah KEMBALI_STOK.
-- sourceKind PUTUS | KONSI = syarat toko saat dibuat (kanal jurnal); spgSaleId / reportedAt salinan
-- supaya pembaca beban tidak membaca tabel laporan.
-- SpgChargeDeduction: satu per beban per baris yang dibayar (ConsignmentCommission / SpgCommission /
-- SpgDebt); kunci unik adalah penjaga basis data agar satu pembayaran tidak memotong dua kali.
--
-- Tanpa isian ulang: belum ada penjualan atau retur SPG di produksi, dan setiap kolom baru boleh
-- NULL atau berisian bawaan. Tanpa FOREIGN KEY (relationMode = "prisma"). Aman dijalankan ulang.

ALTER TABLE "SpgSaleReturn" ADD COLUMN IF NOT EXISTS "goodsPhotoR2Key" TEXT;
ALTER TABLE "SpgSaleReturn" ADD COLUMN IF NOT EXISTS "refundedAt" TIMESTAMP(3);
ALTER TABLE "SpgSaleReturn" ADD COLUMN IF NOT EXISTS "refundSlipR2Key" TEXT;
ALTER TABLE "SpgSaleReturn" ADD COLUMN IF NOT EXISTS "refundMarkedById" TEXT;
ALTER TABLE "SpgSaleReturn" ADD COLUMN IF NOT EXISTS "refundMarkReason" TEXT;

ALTER TABLE "SpgSaleReturn" ALTER COLUMN "status" SET DEFAULT 'MENUNGGU'::"SpgSaleReturnStatus";

CREATE INDEX IF NOT EXISTS "SpgSaleReturn_storeId_refundedAt_idx" ON "SpgSaleReturn"("storeId", "refundedAt");

CREATE TABLE IF NOT EXISTS "SpgCharge" (
  "id" TEXT NOT NULL,
  "spgUserId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "sourceKind" VARCHAR(10) NOT NULL,
  "source" VARCHAR(40) NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceDocNo" TEXT NOT NULL,
  "spgSaleId" TEXT NOT NULL,
  "reportedAt" TIMESTAMP(3) NOT NULL,
  "computedAmount" DECIMAL(15,2) NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "amountReason" TEXT,
  "settledAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "settledAt" TIMESTAMP(3),
  "status" VARCHAR(10) NOT NULL DEFAULT 'TERBUKA',
  "cancelledAt" TIMESTAMP(3),
  "cancelledById" TEXT,
  "cancelReason" TEXT,
  "goodsDecision" VARCHAR(12),
  "goodsDecidedAt" TIMESTAMP(3),
  "goodsDecidedById" TEXT,
  "goodsDecisionNote" TEXT,
  "paybackAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "paybackPaidAt" TIMESTAMP(3),
  "paybackPaidRefType" VARCHAR(40),
  "paybackPaidRefId" TEXT,
  "paybackPayoutMonth" VARCHAR(7),
  "note" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SpgCharge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SpgCharge_source_sourceId_key" ON "SpgCharge"("source", "sourceId");
CREATE INDEX IF NOT EXISTS "SpgCharge_spgUserId_status_idx" ON "SpgCharge"("spgUserId", "status");
CREATE INDEX IF NOT EXISTS "SpgCharge_spgUserId_paybackPaidAt_idx" ON "SpgCharge"("spgUserId", "paybackPaidAt");
CREATE INDEX IF NOT EXISTS "SpgCharge_status_goodsDecision_idx" ON "SpgCharge"("status", "goodsDecision");

CREATE TABLE IF NOT EXISTS "SpgChargeDeduction" (
  "id" TEXT NOT NULL,
  "chargeId" TEXT NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "fromCommission" DECIMAL(15,2) NOT NULL,
  "fromSalary" DECIMAL(15,2) NOT NULL,
  "paidRefType" VARCHAR(40) NOT NULL,
  "paidRefId" TEXT NOT NULL,
  "payoutMonth" VARCHAR(7) NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpgChargeDeduction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SpgChargeDeduction_chargeId_paidRefType_paidRefId_key" ON "SpgChargeDeduction"("chargeId", "paidRefType", "paidRefId");
CREATE INDEX IF NOT EXISTS "SpgChargeDeduction_paidRefType_paidRefId_idx" ON "SpgChargeDeduction"("paidRefType", "paidRefId");
