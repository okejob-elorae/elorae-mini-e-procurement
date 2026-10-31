-- Fitur besar salesman, Tahap 5.
--
-- Pre-order/inden: `PreorderWindow` (jendela pesanan dengan tanggal tutup dan
-- rentang kirim) + `PreorderWindowItem` (barang yang boleh dipesan di jendela
-- itu). Pesanan pre-order = pesanan lapangan biasa yang bertanda
-- `preorderWindowId`; stoknya belum dipesan sampai jendela "dirilis"
-- (`releasedAt`) saat barang produksi datang.
--
-- Eksekusi di toko: `VisitChecklistTemplate` / `VisitChecklistResult` (daftar
-- periksa display & skor per kunjungan), `CompetitorPrice` (harga pesaing),
-- `DisplayGuide` (panduan display dari kantor; foto kunjungan boleh menunjuk
-- panduan yang dijawabnya lewat `VisitPhoto.displayGuideId`).
--
-- `CollectionTask`: tugas penagihan yang dibagikan kantor ke seseorang.
-- `StoreExchange` + `StoreExchangeLine`: tukar barang (MASUK dari toko,
-- KELUAR ke toko), terpisah dari retur yang menyangkut uang.
-- `FieldSalesDelivery.receivedByName/receivedAt/podPhotoUrl`: bukti terima.
-- `StorePortalLink`: tautan pesan mandiri untuk toko; hanya hash tokennya
-- yang disimpan.
ALTER TABLE "FieldSalesOrder" ADD COLUMN "preorderWindowId" TEXT;
CREATE INDEX "FieldSalesOrder_preorderWindowId_idx" ON "FieldSalesOrder"("preorderWindowId");
ALTER TABLE "FieldSalesDelivery" ADD COLUMN "receivedByName" TEXT;
ALTER TABLE "FieldSalesDelivery" ADD COLUMN "receivedAt" TIMESTAMP(3);
ALTER TABLE "FieldSalesDelivery" ADD COLUMN "podPhotoUrl" TEXT;
ALTER TABLE "VisitPhoto" ADD COLUMN "displayGuideId" TEXT;

CREATE TABLE "PreorderWindow" (
    "id" TEXT NOT NULL, "name" TEXT NOT NULL, "note" TEXT,
    "opensAt" TIMESTAMP(3) NOT NULL, "closesAt" TIMESTAMP(3) NOT NULL,
    "shipFrom" TIMESTAMP(3), "shipTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true, "releasedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PreorderWindow_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PreorderWindow_isActive_closesAt_idx" ON "PreorderWindow"("isActive", "closesAt");

CREATE TABLE "PreorderWindowItem" (
    "id" TEXT NOT NULL, "windowId" TEXT NOT NULL, "itemId" TEXT NOT NULL, "plannedQty" INTEGER,
    CONSTRAINT "PreorderWindowItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PreorderWindowItem_windowId_itemId_key" ON "PreorderWindowItem"("windowId", "itemId");
CREATE INDEX "PreorderWindowItem_itemId_idx" ON "PreorderWindowItem"("itemId");

CREATE TABLE "VisitChecklistTemplate" (
    "id" TEXT NOT NULL, "name" TEXT NOT NULL, "termsType" "StoreTermsType", "questions" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VisitChecklistTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VisitChecklistResult" (
    "id" TEXT NOT NULL, "visitId" TEXT NOT NULL, "templateId" TEXT NOT NULL, "answers" JSONB NOT NULL,
    "score" INTEGER NOT NULL, "maxScore" INTEGER NOT NULL, "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VisitChecklistResult_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VisitChecklistResult_visitId_templateId_key" ON "VisitChecklistResult"("visitId", "templateId");
CREATE INDEX "VisitChecklistResult_templateId_idx" ON "VisitChecklistResult"("templateId");

CREATE TABLE "CompetitorPrice" (
    "id" TEXT NOT NULL, "storeId" TEXT NOT NULL, "visitId" TEXT, "brand" TEXT NOT NULL,
    "productName" TEXT NOT NULL, "category" TEXT, "price" DECIMAL(15,2) NOT NULL,
    "photoUrl" TEXT, "note" TEXT, "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompetitorPrice_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CompetitorPrice_storeId_createdAt_idx" ON "CompetitorPrice"("storeId", "createdAt");
CREATE INDEX "CompetitorPrice_brand_idx" ON "CompetitorPrice"("brand");

CREATE TABLE "DisplayGuide" (
    "id" TEXT NOT NULL, "title" TEXT NOT NULL, "body" TEXT NOT NULL, "imageUrl" TEXT,
    "termsType" "StoreTermsType", "groupId" TEXT, "activeFrom" TIMESTAMP(3), "activeTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true, "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DisplayGuide_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollectionTask" (
    "id" TEXT NOT NULL, "assigneeId" TEXT NOT NULL, "storeId" TEXT NOT NULL, "receivableIds" JSONB NOT NULL,
    "note" TEXT, "dueDate" TIMESTAMP(3), "status" TEXT NOT NULL DEFAULT 'TERBUKA',
    "createdById" TEXT NOT NULL, "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CollectionTask_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CollectionTask_assigneeId_status_idx" ON "CollectionTask"("assigneeId", "status");
CREATE INDEX "CollectionTask_storeId_idx" ON "CollectionTask"("storeId");

CREATE TABLE "StoreExchange" (
    "id" TEXT NOT NULL, "docNo" TEXT NOT NULL, "storeId" TEXT NOT NULL, "salesmanId" TEXT NOT NULL,
    "visitId" TEXT, "status" TEXT NOT NULL DEFAULT 'DIAJUKAN', "note" TEXT,
    "reviewedById" TEXT, "reviewedAt" TIMESTAMP(3), "reviewNote" TEXT, "completedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StoreExchange_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StoreExchange_docNo_key" ON "StoreExchange"("docNo");
CREATE UNIQUE INDEX "StoreExchange_idempotencyKey_key" ON "StoreExchange"("idempotencyKey");
CREATE INDEX "StoreExchange_storeId_createdAt_idx" ON "StoreExchange"("storeId", "createdAt");
CREATE INDEX "StoreExchange_status_createdAt_idx" ON "StoreExchange"("status", "createdAt");

CREATE TABLE "StoreExchangeLine" (
    "id" TEXT NOT NULL, "exchangeId" TEXT NOT NULL, "direction" TEXT NOT NULL, "itemId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL DEFAULT '', "productName" TEXT NOT NULL, "qty" INTEGER NOT NULL,
    CONSTRAINT "StoreExchangeLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StoreExchangeLine_exchangeId_idx" ON "StoreExchangeLine"("exchangeId");

CREATE TABLE "StorePortalLink" (
    "id" TEXT NOT NULL, "storeId" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "label" TEXT,
    "createdById" TEXT NOT NULL, "expiresAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3), "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StorePortalLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StorePortalLink_tokenHash_key" ON "StorePortalLink"("tokenHash");
CREATE INDEX "StorePortalLink_storeId_idx" ON "StorePortalLink"("storeId");
