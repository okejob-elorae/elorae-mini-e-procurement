-- SPG tahap 2, keputusan pemilik 2026-10-03:
-- * Promo konter di toko konsinyasi bisa ditanggung penuh Elorae atau dibagi
--   dengan toko: `CounterPromo.storeSharePercent` (bagian toko, 0 = penuh
--   Elorae) dan `SpgSaleLine.storeDiscount` (bagian toko dari potongan baris,
--   dibekukan saat nota dicatat).
-- * Barang rusak yang dikembalikan pembeli masuk GUDANG BARANG RUSAK:
--   `DamagedStockMovement` (saldo = jumlah qty, bertanda). Baris nota retur
--   toko bisa menunjuk retur pembeli asalnya (`spgSaleReturnLineId`).
-- * Barang hilang dengan penanggung yang dibagi (toko / SPG / sales / Elorae):
--   `StockLoss` + `StockLossLine` + `StockLossShare`.
-- AlterTable
ALTER TABLE "CounterPromo" ADD COLUMN     "storeSharePercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SpgSaleLine" ADD COLUMN     "storeDiscount" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StoreReturnItem" ADD COLUMN     "spgSaleReturnLineId" TEXT;

-- CreateTable
CREATE TABLE "DamagedStockMovement" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "productName" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "value" DECIMAL(15,2),
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DamagedStockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLoss" (
    "id" TEXT NOT NULL,
    "storeId" TEXT,
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceDocNo" TEXT,
    "totalQty" INTEGER NOT NULL,
    "totalAmount" DECIMAL(15,2) NOT NULL,
    "valueBasis" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'TERBUKA',
    "note" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdById" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLoss_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLossLine" (
    "id" TEXT NOT NULL,
    "lossId" TEXT NOT NULL,
    "itemId" TEXT,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "productName" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitValue" DECIMAL(15,2) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "StockLossLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLossShare" (
    "id" TEXT NOT NULL,
    "lossId" TEXT NOT NULL,
    "bearer" TEXT NOT NULL,
    "bearerUserId" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "settledById" TEXT,
    "settleNote" TEXT,

    CONSTRAINT "StockLossShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DamagedStockMovement_itemId_variantSku_idx" ON "DamagedStockMovement"("itemId", "variantSku");

-- CreateIndex
CREATE INDEX "DamagedStockMovement_refType_refId_idx" ON "DamagedStockMovement"("refType", "refId");

-- CreateIndex
CREATE INDEX "DamagedStockMovement_createdAt_idx" ON "DamagedStockMovement"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockLoss_idempotencyKey_key" ON "StockLoss"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StockLoss_storeId_status_idx" ON "StockLoss"("storeId", "status");

-- CreateIndex
CREATE INDEX "StockLoss_source_sourceId_idx" ON "StockLoss"("source", "sourceId");

-- CreateIndex
CREATE INDEX "StockLoss_status_createdAt_idx" ON "StockLoss"("status", "createdAt");

-- CreateIndex
CREATE INDEX "StockLossLine_lossId_idx" ON "StockLossLine"("lossId");

-- CreateIndex
CREATE INDEX "StockLossShare_lossId_idx" ON "StockLossShare"("lossId");

-- CreateIndex
CREATE INDEX "StockLossShare_bearerUserId_settledAt_idx" ON "StockLossShare"("bearerUserId", "settledAt");

-- CreateIndex
CREATE INDEX "StockLossShare_bearer_settledAt_idx" ON "StockLossShare"("bearer", "settledAt");


-- Dibekukan saat siklus konsinyasi dikunci: potongan promo konter yang
-- ditanggung Elorae (mengurangi tagihan ke toko) dan beban barang hilang yang
-- ditetapkan ke toko (menambah tagihan).
ALTER TABLE "ConsignmentCycle" ADD COLUMN "promoBorneByElorae" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN "lossChargedToStore" DECIMAL(15,2) NOT NULL DEFAULT 0;
