-- SPG tahap 2 (2026-10-03): jual tanpa sinyal, promo & diskon konter,
-- laporan tutup hari, pelanggan & titip pesan, jadwal & shift, info produk,
-- komisi SPG toko putus, dan barang rusak saat menerima kiriman.
--
-- SpgSale/SpgSaleLine: `lineTotal` dan `total` kini BERSIH sesudah potongan
-- (baris lama tidak berpotongan, jadi nilainya tidak berubah); `subtotal` dan
-- `unitPrice` tetap harga sebelum potongan. Penjualan yang dicatat tanpa sinyal
-- membawa waktu jualnya sendiri di `createdAt` dan waktu terkirimnya di `syncedAt`.
--
-- StoreReceiptLine: `qtyReceived` tetap jumlah yang TIBA (termasuk yang rusak);
-- buku stok toko hanya menambah `qtyReceived - qtyDamaged`. Keputusan kantor
-- atas barang rusak ada di kolom damage*.
-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "careInstructions" TEXT,
ADD COLUMN     "material" TEXT,
ADD COLUMN     "sizeChartId" TEXT;

-- AlterTable
ALTER TABLE "SpgSale" ADD COLUMN     "capturedOffline" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "discountTotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "manualDiscount" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "manualDiscountReason" TEXT,
ADD COLUMN     "orderDiscount" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "orderPromoId" TEXT,
ADD COLUMN     "orderPromoName" TEXT,
ADD COLUMN     "syncedAt" TIMESTAMP(3),
ADD COLUMN     "visitId" TEXT;

-- AlterTable
ALTER TABLE "SpgSaleLine" ADD COLUMN     "counterPromoId" TEXT,
ADD COLUMN     "discount" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "promoName" TEXT;

-- AlterTable
ALTER TABLE "StoreReceiptLine" ADD COLUMN     "damageDecidedAt" TIMESTAMP(3),
ADD COLUMN     "damageDecidedById" TEXT,
ADD COLUMN     "damageDecisionNote" TEXT,
ADD COLUMN     "damageNote" TEXT,
ADD COLUMN     "damagePhotoUrl" TEXT,
ADD COLUMN     "damageStatus" TEXT,
ADD COLUMN     "qtyDamaged" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StoreReturnItem" ADD COLUMN     "storeReceiptLineId" TEXT;

-- CreateTable
CREATE TABLE "CounterPromo" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DECIMAL(15,2),
    "buyQty" INTEGER,
    "freeQty" INTEGER,
    "minSubtotal" DECIMAL(15,2),
    "allItems" BOOLEAN NOT NULL DEFAULT true,
    "allStores" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CounterPromo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CounterPromoTarget" (
    "id" TEXT NOT NULL,
    "promoId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,

    CONSTRAINT "CounterPromoTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreCustomer" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "note" TEXT,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerRequest" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "itemId" TEXT,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'MENUNGGU',
    "holdUntil" TEXT,
    "availableAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "notifiedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closeReason" TEXT,
    "spgSaleId" TEXT,
    "lostSaleId" TEXT,
    "createdById" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpgDailyClose" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "closedById" TEXT NOT NULL,
    "notaCount" INTEGER NOT NULL,
    "pcs" INTEGER NOT NULL,
    "returnPcs" INTEGER NOT NULL DEFAULT 0,
    "grossTotal" DECIMAL(15,2) NOT NULL,
    "discountTotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "netTotal" DECIMAL(15,2) NOT NULL,
    "visitorCount" INTEGER,
    "cashierTotal" DECIMAL(15,2),
    "note" TEXT,
    "photoUrls" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpgDailyClose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpgShift" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "shiftCode" TEXT,
    "startTime" TEXT,
    "endTime" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpgShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpgShiftSwap" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "partnerDay" TEXT,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'MENUNGGU_REKAN',
    "partnerAnsweredAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpgShiftSwap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SizeChart" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'cm',
    "columns" JSONB NOT NULL,
    "rows" JSONB NOT NULL,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SizeChart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpgCommission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "unitsSold" INTEGER NOT NULL,
    "commission" DECIMAL(15,2) NOT NULL,
    "basis" TEXT NOT NULL,
    "lockedById" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpgCommission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CounterPromo_isActive_idx" ON "CounterPromo"("isActive");

-- CreateIndex
CREATE INDEX "CounterPromoTarget_kind_refId_idx" ON "CounterPromoTarget"("kind", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "CounterPromoTarget_promoId_kind_refId_key" ON "CounterPromoTarget"("promoId", "kind", "refId");

-- CreateIndex
CREATE INDEX "StoreCustomer_storeId_name_idx" ON "StoreCustomer"("storeId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "StoreCustomer_storeId_phone_key" ON "StoreCustomer"("storeId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRequest_idempotencyKey_key" ON "CustomerRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CustomerRequest_storeId_status_idx" ON "CustomerRequest"("storeId", "status");

-- CreateIndex
CREATE INDEX "CustomerRequest_customerId_idx" ON "CustomerRequest"("customerId");

-- CreateIndex
CREATE INDEX "CustomerRequest_itemId_variantSku_idx" ON "CustomerRequest"("itemId", "variantSku");

-- CreateIndex
CREATE INDEX "SpgDailyClose_day_idx" ON "SpgDailyClose"("day");

-- CreateIndex
CREATE UNIQUE INDEX "SpgDailyClose_storeId_day_key" ON "SpgDailyClose"("storeId", "day");

-- CreateIndex
CREATE INDEX "SpgShift_storeId_day_idx" ON "SpgShift"("storeId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "SpgShift_userId_day_key" ON "SpgShift"("userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "SpgShiftSwap_idempotencyKey_key" ON "SpgShiftSwap"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SpgShiftSwap_storeId_status_idx" ON "SpgShiftSwap"("storeId", "status");

-- CreateIndex
CREATE INDEX "SpgShiftSwap_requesterId_idx" ON "SpgShiftSwap"("requesterId");

-- CreateIndex
CREATE INDEX "SpgShiftSwap_partnerId_idx" ON "SpgShiftSwap"("partnerId");

-- CreateIndex
CREATE INDEX "SizeChart_categoryId_idx" ON "SizeChart"("categoryId");

-- CreateIndex
CREATE INDEX "SpgCommission_period_idx" ON "SpgCommission"("period");

-- CreateIndex
CREATE UNIQUE INDEX "SpgCommission_userId_storeId_period_key" ON "SpgCommission"("userId", "storeId", "period");

-- CreateIndex
CREATE INDEX "SpgSale_customerId_idx" ON "SpgSale"("customerId");
