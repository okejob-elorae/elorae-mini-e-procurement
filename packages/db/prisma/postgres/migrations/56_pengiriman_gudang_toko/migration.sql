-- Pengiriman gudang → toko (jawaban pemilik 2026-11-02: Q1, P16, P17, P24, P26, P33a, P34–P45a).
-- Hanya model yang ADA di sisi PostgreSQL: DeliveryShipment, DeliveryShipmentLine, KonsiTransfer
-- dan KonsiTransferLine tidak ada di schema ini, jadi kolom-kolomnya tidak ditambahkan di sini.
--
-- FieldSalesDelivery.voidedAt/voidedById/voidReason: nota dibatalkan ("tidak jadi dikirim", atau
--   seluruh barang ditolak di depan pintu). correctedAt: koreksi terakhir ke jumlah diterima.
-- FieldSalesDeliveryLine.returnedQty/lostQty: qty tetap jumlah DITAGIH; yang semula dikirim =
--   qty + returnedQty + lostQty.
-- StoreReceipt.receivedVia (SPG | POD | SALESMAN) + picName/photoUrl/photoR2Key: siapa yang
--   mencatat penerimaan toko; untuk salesman pemegang, nama penanggung jawab toko + foto (P45a).
-- StoreReceiptLine.qtyRefused: ditolak di depan pintu ("dibawa pulang kurir", P40).
-- StockLoss.shipmentId/claimValue: pengiriman asal barang hilang di perjalanan, dan nilai klaim
--   ekspedisi (nilai jual di nota / surat jalan).
-- StockLossShare.claim*: klaim EKSPEDISI (DIAJUKAN → MENUNGGU_CEK → DIBAYAR, atau DITOLAK).
-- Tanpa FOREIGN KEY (relationMode = "prisma"). Menambah saja, aman dijalankan ulang.

ALTER TABLE "FieldSalesDelivery" ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3);
ALTER TABLE "FieldSalesDelivery" ADD COLUMN IF NOT EXISTS "voidedById" TEXT;
ALTER TABLE "FieldSalesDelivery" ADD COLUMN IF NOT EXISTS "voidReason" TEXT;
ALTER TABLE "FieldSalesDelivery" ADD COLUMN IF NOT EXISTS "correctedAt" TIMESTAMP(3);

ALTER TABLE "FieldSalesDeliveryLine" ADD COLUMN IF NOT EXISTS "returnedQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "FieldSalesDeliveryLine" ADD COLUMN IF NOT EXISTS "lostQty" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "StoreReceipt" ADD COLUMN IF NOT EXISTS "receivedVia" TEXT;
ALTER TABLE "StoreReceipt" ADD COLUMN IF NOT EXISTS "picName" TEXT;
ALTER TABLE "StoreReceipt" ADD COLUMN IF NOT EXISTS "photoUrl" TEXT;
ALTER TABLE "StoreReceipt" ADD COLUMN IF NOT EXISTS "photoR2Key" TEXT;

ALTER TABLE "StoreReceiptLine" ADD COLUMN IF NOT EXISTS "qtyRefused" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "StockLoss" ADD COLUMN IF NOT EXISTS "shipmentId" TEXT;
ALTER TABLE "StockLoss" ADD COLUMN IF NOT EXISTS "claimValue" DECIMAL(15,2);
CREATE INDEX IF NOT EXISTS "StockLoss_shipmentId_idx" ON "StockLoss"("shipmentId");

ALTER TABLE "StockLossShare" ADD COLUMN IF NOT EXISTS "claimStatus" TEXT;
ALTER TABLE "StockLossShare" ADD COLUMN IF NOT EXISTS "claimSubmittedAt" TIMESTAMP(3);
ALTER TABLE "StockLossShare" ADD COLUMN IF NOT EXISTS "claimRecordedAt" TIMESTAMP(3);
ALTER TABLE "StockLossShare" ADD COLUMN IF NOT EXISTS "claimRecordedById" TEXT;
ALTER TABLE "StockLossShare" ADD COLUMN IF NOT EXISTS "claimPaidMethod" TEXT;
ALTER TABLE "StockLossShare" ADD COLUMN IF NOT EXISTS "claimReference" TEXT;
ALTER TABLE "StockLossShare" ADD COLUMN IF NOT EXISTS "claimDecidedAt" TIMESTAMP(3);
ALTER TABLE "StockLossShare" ADD COLUMN IF NOT EXISTS "claimDecidedById" TEXT;
ALTER TABLE "StockLossShare" ADD COLUMN IF NOT EXISTS "claimNote" TEXT;
CREATE INDEX IF NOT EXISTS "StockLossShare_bearer_claimStatus_idx" ON "StockLossShare"("bearer", "claimStatus");
