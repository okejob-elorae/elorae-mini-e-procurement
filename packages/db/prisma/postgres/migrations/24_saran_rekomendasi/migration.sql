-- Permintaan SPG ke salesman dan rekomendasi salesman ke toko (2026-10-01).
--
-- Permintaan kiriman SPG (`StockRequest`) kini juga ditangani salesman
-- pemegang toko; pesanan yang dibuat darinya ditautkan lewat
-- `fieldSalesOrderId`, dan tiap baris membawa alasannya (laku di toko lain,
-- sering dikirim, barang baru, …) supaya penerimanya tahu kenapa diminta.
--
-- `StoreRecommendation`: salesman merekomendasikan barang ke toko/SPG
-- ("ambil barang dari kami"). SPG menerima atau menolak; yang diterima
-- menjadi pesanan biasa lewat keranjang yang diisi otomatis — tidak pernah
-- terkirim sendiri.
ALTER TABLE "StockRequest" ADD COLUMN "fieldSalesOrderId" TEXT;
CREATE INDEX "StockRequest_fieldSalesOrderId_idx" ON "StockRequest"("fieldSalesOrderId");
ALTER TABLE "StockRequestLine" ADD COLUMN "alasan" TEXT;

CREATE TYPE "StoreRecommendationStatus" AS ENUM ('TERKIRIM', 'DITERIMA', 'DITOLAK', 'SELESAI', 'DIBATALKAN');

CREATE TABLE "StoreRecommendation" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "salesmanId" TEXT NOT NULL,
    "status" "StoreRecommendationStatus" NOT NULL DEFAULT 'TERKIRIM',
    "note" TEXT,
    "respondedById" TEXT,
    "respondedAt" TIMESTAMP(3),
    "responseNote" TEXT,
    "fieldSalesOrderId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreRecommendation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoreRecommendationLine" (
    "id" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "productName" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "alasan" TEXT,

    CONSTRAINT "StoreRecommendationLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoreRecommendation_idempotencyKey_key" ON "StoreRecommendation"("idempotencyKey");
CREATE INDEX "StoreRecommendation_storeId_status_idx" ON "StoreRecommendation"("storeId", "status");
CREATE INDEX "StoreRecommendation_salesmanId_createdAt_idx" ON "StoreRecommendation"("salesmanId", "createdAt");
CREATE INDEX "StoreRecommendationLine_recommendationId_idx" ON "StoreRecommendationLine"("recommendationId");
