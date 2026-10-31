-- SPG: kirim barang antar toko (mutasi) dan retur (2026-10-01).
--
-- Mutasi: `StoreTransfer` + baris. Hanya barang KITA yang boleh berpindah
-- (konsinyasi → konsinyasi bawaannya); barang toko putus milik toko itu, jadi
-- arah yang melibatkan toko putus ditolak kecuali pemilik mengubah aturannya.
-- Barang keluar dari buku toko pengirim saat DIKIRIM (MUTASI_KELUAR) dan masuk
-- ke buku toko penerima saat penerima menghitung dan mengonfirmasi
-- (StoreReceipt sumber "MUTASI", MUTASI_MASUK). Stok gudang utama TIDAK
-- bergerak: barangnya tidak pernah lewat gudang.
--
-- Retur: nota retur toko kini boleh membawa baris per ukuran dan kondisi
-- (LAYAK/RUSAK) dan menandai laporan dari SPG; barang keluar dari buku toko
-- saat diserahkan (RETUR_KELUAR). Barang yang dikembalikan PEMBELI ke counter
-- (uangnya dikembalikan kasir toko) dicatat di `SpgSaleReturn`, tertaut ke
-- baris nota SPG; `returnedQty` mencegah mengembalikan lebih dari yang terjual.
--
-- ADD VALUE tidak boleh dipakai di transaksi yang sama — berkas ini tidak memakainya.
ALTER TYPE "StoreStockKind" ADD VALUE IF NOT EXISTS 'MUTASI_KELUAR';
ALTER TYPE "StoreStockKind" ADD VALUE IF NOT EXISTS 'MUTASI_MASUK';
ALTER TYPE "StoreStockKind" ADD VALUE IF NOT EXISTS 'RETUR_KELUAR';
ALTER TYPE "StoreStockKind" ADD VALUE IF NOT EXISTS 'RETUR_PEMBELI';

CREATE TYPE "StoreTransferStatus" AS ENUM ('DIAJUKAN', 'DISETUJUI', 'DIKIRIM', 'DITERIMA', 'DITOLAK', 'DIBATALKAN', 'DIKEMBALIKAN');
CREATE TYPE "StoreTransferSelisih" AS ENUM ('TERBUKA', 'HILANG', 'KEMBALI');

CREATE TABLE "StoreTransfer" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "fromStoreId" TEXT NOT NULL,
    "toStoreId" TEXT NOT NULL,
    "status" "StoreTransferStatus" NOT NULL DEFAULT 'DIAJUKAN',
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "shippedById" TEXT,
    "shippedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "selisihStatus" "StoreTransferSelisih",
    "selisihNote" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreTransfer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoreTransferLine" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "productName" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "StoreTransferLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoreTransfer_docNo_key" ON "StoreTransfer"("docNo");
CREATE UNIQUE INDEX "StoreTransfer_idempotencyKey_key" ON "StoreTransfer"("idempotencyKey");
CREATE INDEX "StoreTransfer_fromStoreId_status_idx" ON "StoreTransfer"("fromStoreId", "status");
CREATE INDEX "StoreTransfer_toStoreId_status_idx" ON "StoreTransfer"("toStoreId", "status");
CREATE INDEX "StoreTransfer_status_createdAt_idx" ON "StoreTransfer"("status", "createdAt");
CREATE INDEX "StoreTransferLine_transferId_idx" ON "StoreTransferLine"("transferId");
CREATE INDEX "StoreTransferLine_itemId_idx" ON "StoreTransferLine"("itemId");

ALTER TABLE "SpgSaleLine" ADD COLUMN "returnedQty" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "SpgSaleReturn" (
    "id" TEXT NOT NULL,
    "spgSaleId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpgSaleReturn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SpgSaleReturnLine" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "spgSaleLineId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "qty" INTEGER NOT NULL,
    "condition" "ReturnItemCondition" NOT NULL DEFAULT 'LAYAK',

    CONSTRAINT "SpgSaleReturnLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SpgSaleReturn_idempotencyKey_key" ON "SpgSaleReturn"("idempotencyKey");
CREATE INDEX "SpgSaleReturn_spgSaleId_idx" ON "SpgSaleReturn"("spgSaleId");
CREATE INDEX "SpgSaleReturn_storeId_createdAt_idx" ON "SpgSaleReturn"("storeId", "createdAt");
CREATE INDEX "SpgSaleReturnLine_returnId_idx" ON "SpgSaleReturnLine"("returnId");
CREATE INDEX "SpgSaleReturnLine_spgSaleLineId_idx" ON "SpgSaleReturnLine"("spgSaleLineId");

ALTER TABLE "StoreReturn" ADD COLUMN "reportedBySpg" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StoreReturnItem" ADD COLUMN "variantSku" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StoreReturnItem" ADD COLUMN "condition" "ReturnItemCondition" NOT NULL DEFAULT 'LAYAK';
ALTER TABLE "WarehouseReturnItem" ADD COLUMN "variantSku" TEXT NOT NULL DEFAULT '';
