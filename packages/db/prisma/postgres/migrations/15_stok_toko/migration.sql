-- Buku stok toko dan pekerjaan SPG di toko.
--
-- Sebelumnya penjualan SPG hanya catatan: tidak ada yang tahu berapa barang
-- tersisa di toko. `StoreStockMovement` adalah bukunya — saldo = Σ qty,
-- dihitung, tidak disimpan (pola yang sama dengan stok titipan konsinyasi).
-- Masuk lewat penerimaan kiriman yang DIHITUNG dan DIKONFIRMASI SPG
-- (`StoreReceipt`, unik per dokumen sumber supaya satu kiriman tidak pernah
-- diterima dua kali), keluar lewat penjualan SPG, dikoreksi lewat opname
-- (`StoreOpname`). Saldo boleh negatif: penjualan tidak ditolak karena stok
-- sistem nol — yang laku di toko adalah fakta, selisihnya urusan opname.
--
-- `StockRequest` = SPG minta kiriman; `LostSale` = barang yang dicari pembeli
-- tapi tidak ada. Keduanya dibaca kantor.
-- CreateEnum
CREATE TYPE "StoreStockKind" AS ENUM ('TERIMA', 'JUAL', 'OPNAME');

-- CreateEnum
CREATE TYPE "StockRequestStatus" AS ENUM ('BARU', 'DIPROSES', 'SELESAI', 'DITOLAK');

-- CreateTable
CREATE TABLE "StoreStockMovement" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "qty" INTEGER NOT NULL,
    "kind" "StoreStockKind" NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreStockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreReceipt" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceDocNo" TEXT NOT NULL,
    "receivedById" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "StoreReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "itemId" TEXT,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "productName" TEXT NOT NULL,
    "qtySent" INTEGER NOT NULL,
    "qtyReceived" INTEGER NOT NULL,

    CONSTRAINT "StoreReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreOpname" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "countedById" TEXT NOT NULL,
    "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "StoreOpname_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreOpnameLine" (
    "id" TEXT NOT NULL,
    "opnameId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "productName" TEXT NOT NULL,
    "qtySystem" INTEGER NOT NULL,
    "qtyCounted" INTEGER NOT NULL,

    CONSTRAINT "StoreOpnameLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockRequest" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "StockRequestStatus" NOT NULL DEFAULT 'BARU',
    "note" TEXT,
    "handledById" TEXT,
    "handledAt" TIMESTAMP(3),
    "handleNote" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockRequestLine" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "productName" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "StockRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LostSale" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LostSale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoreStockMovement_storeId_itemId_variantSku_idx" ON "StoreStockMovement"("storeId", "itemId", "variantSku");

-- CreateIndex
CREATE INDEX "StoreStockMovement_storeId_createdAt_idx" ON "StoreStockMovement"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "StoreStockMovement_refType_refId_idx" ON "StoreStockMovement"("refType", "refId");

-- CreateIndex
CREATE INDEX "StoreReceipt_storeId_receivedAt_idx" ON "StoreReceipt"("storeId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoreReceipt_sourceType_sourceId_key" ON "StoreReceipt"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "StoreReceiptLine_receiptId_idx" ON "StoreReceiptLine"("receiptId");

-- CreateIndex
CREATE INDEX "StoreOpname_storeId_countedAt_idx" ON "StoreOpname"("storeId", "countedAt");

-- CreateIndex
CREATE INDEX "StoreOpnameLine_opnameId_idx" ON "StoreOpnameLine"("opnameId");

-- CreateIndex
CREATE UNIQUE INDEX "StockRequest_idempotencyKey_key" ON "StockRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StockRequest_storeId_status_idx" ON "StockRequest"("storeId", "status");

-- CreateIndex
CREATE INDEX "StockRequest_status_createdAt_idx" ON "StockRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "StockRequestLine_requestId_idx" ON "StockRequestLine"("requestId");

-- CreateIndex
CREATE INDEX "LostSale_storeId_createdAt_idx" ON "LostSale"("storeId", "createdAt");

