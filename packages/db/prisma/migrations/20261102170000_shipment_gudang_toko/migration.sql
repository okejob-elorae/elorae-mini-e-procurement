-- Pengiriman gudang → toko (owner answers 2026-11-02: Q1, P16, P17, P24, P26, P33a, P34–P45a).
--
-- KONSI: creating the delivery shipment IS the surat jalan and the transfer. Main stock is cut at
-- creation and a KonsiTransfer is written IN_TRANSIT ("Gudang Toko, dalam perjalanan"); the store
-- receipt (SPG, the POD at a store without an SPG, or the holder salesman when the SPG has left)
-- moves it to RECEIVED and raises StoreStock by what arrived. "Tidak jadi dikirim" CANCELS it and
-- returns the goods to the main warehouse.
-- KonsiTransfer.status DEFAULT 'RECEIVED' on purpose: every existing row already raised StoreStock
--   when it was written, and so does a row the OLD image writes during the deploy window (the
--   migration runs before the new image is live). New code always writes IN_TRANSIT explicitly.
-- KonsiTransfer.receivedAt / receivedById / cancelledAt / cancelledById / cancelReason / adjustedAt:
--   the receipt, the cancellation and the latest door-refusal adjustment.
-- KonsiTransferLine.returnedQty: pieces refused at the door or returned by a cancel (they went
--   back to the main warehouse). receivedQty: pieces that arrived (NULL until received).
--   unitPrice: the konsi price snapshotted at shipment creation — the surat jalan lists it like a
--   nota (no faktur, P37), and a konsi expedition claim is valued at it.
-- PUTUS: the nota tagihan is issued when the shipment is CREATED (owner putus answer, P17).
-- DeliveryShipment.idempotencyKey: one per create dialog, so a double submit makes one shipment.
--   cancelReason: required for "tidak jadi dikirim". weightKg + handoverPhotoUrl/R2Key: mandatory
--   before an expedition shipment leaves (P35, P43).
-- DeliveryShipmentLine.returnedQty / lostQty: what the store refused at the door and what went
--   missing in transit, when the POD is the store receipt.
-- FieldSalesDelivery.voidedAt / voidedById / voidReason: the nota was cancelled ("tidak jadi
--   dikirim", or every piece refused at the door). correctedAt: last correction to the received qty.
-- FieldSalesDeliveryLine.returnedQty / lostQty: qty stays the BILLED quantity; the pieces
--   originally sent = qty + returnedQty + lostQty.
-- StoreReceipt.receivedVia (SPG | POD | SALESMAN) + picName / photoUrl / photoR2Key: who recorded
--   the store's receipt, and for the holder salesman the store PIC's name and a photo (P45a).
-- StoreReceiptLine.qtyRefused: refused at the door ("dibawa pulang kurir", P40); qtySent is what
--   stayed at the store's door after the refusal.
-- StockLoss.shipmentId / claimValue: the shipment a loss in transit came from, and the expedition
--   claim value (nilai jual di nota / surat jalan).
-- StockLossShare.claim*: the EKSPEDISI claim (DIAJUKAN → MENUNGGU_CEK → DIBAYAR, or DITOLAK).
--
-- The preflight aborts only when open shipments of the OLD rule exist (PACKED or IN_TRANSIT before
-- the idempotencyKey column existed): the new completion would refuse them, and they must be
-- cancelled first. It bites only on the first run — once the column exists it reads 'preflight ok'.
-- On abort the migration is recorded failed: `prisma migrate resolve --rolled-back <name>`, cancel
-- or remove the open test shipments, then re-run. Production has no shipments (owner).
--
-- The two UPDATEs make "RECEIVED ⇒ receivedAt and receivedQty are set" true for every row; both
-- are guarded on NULL, so re-running them touches nothing new.
-- No FOREIGN KEY (relationMode = "prisma"). Additive and re-runnable (IF NOT EXISTS).

SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'DeliveryShipment' AND COLUMN_NAME = 'idempotencyKey') > 0
  OR (SELECT COUNT(*) FROM `DeliveryShipment` WHERE `status` IN ('PACKED', 'IN_TRANSIT')) = 0,
  'preflight ok',
  (SELECT 'ABORT: pengiriman terbuka dari aturan lama' UNION ALL SELECT 'ABORT')
) AS preflight;

ALTER TABLE `KonsiTransfer`
  ADD COLUMN IF NOT EXISTS `status` ENUM('IN_TRANSIT', 'RECEIVED', 'CANCELLED') NOT NULL DEFAULT 'RECEIVED',
  ADD COLUMN IF NOT EXISTS `receivedAt` DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS `receivedById` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `cancelledAt` DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS `cancelledById` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `cancelReason` TEXT NULL,
  ADD COLUMN IF NOT EXISTS `adjustedAt` DATETIME(3) NULL;

CREATE INDEX IF NOT EXISTS `KonsiTransfer_storeId_status_idx` ON `KonsiTransfer`(`storeId`, `status`);

ALTER TABLE `KonsiTransferLine`
  ADD COLUMN IF NOT EXISTS `returnedQty` INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `receivedQty` INT NULL,
  ADD COLUMN IF NOT EXISTS `unitPrice` DECIMAL(15, 2) NULL;

ALTER TABLE `DeliveryShipment`
  ADD COLUMN IF NOT EXISTS `idempotencyKey` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `cancelReason` TEXT NULL,
  ADD COLUMN IF NOT EXISTS `weightKg` DECIMAL(10, 2) NULL,
  ADD COLUMN IF NOT EXISTS `handoverPhotoUrl` TEXT NULL,
  ADD COLUMN IF NOT EXISTS `handoverPhotoR2Key` VARCHAR(191) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS `DeliveryShipment_idempotencyKey_key` ON `DeliveryShipment`(`idempotencyKey`);

ALTER TABLE `DeliveryShipmentLine`
  ADD COLUMN IF NOT EXISTS `returnedQty` INT NULL,
  ADD COLUMN IF NOT EXISTS `lostQty` INT NULL;

ALTER TABLE `FieldSalesDelivery`
  ADD COLUMN IF NOT EXISTS `voidedAt` DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS `voidedById` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `voidReason` TEXT NULL,
  ADD COLUMN IF NOT EXISTS `correctedAt` DATETIME(3) NULL;

ALTER TABLE `FieldSalesDeliveryLine`
  ADD COLUMN IF NOT EXISTS `returnedQty` INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `lostQty` INT NOT NULL DEFAULT 0;

ALTER TABLE `StoreReceipt`
  ADD COLUMN IF NOT EXISTS `receivedVia` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `picName` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `photoUrl` TEXT NULL,
  ADD COLUMN IF NOT EXISTS `photoR2Key` VARCHAR(191) NULL;

ALTER TABLE `StoreReceiptLine`
  ADD COLUMN IF NOT EXISTS `qtyRefused` INT NOT NULL DEFAULT 0;

ALTER TABLE `StockLoss`
  ADD COLUMN IF NOT EXISTS `shipmentId` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `claimValue` DECIMAL(15, 2) NULL;

CREATE INDEX IF NOT EXISTS `StockLoss_shipmentId_idx` ON `StockLoss`(`shipmentId`);

ALTER TABLE `StockLossShare`
  ADD COLUMN IF NOT EXISTS `claimStatus` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `claimSubmittedAt` DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS `claimRecordedAt` DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS `claimRecordedById` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `claimPaidMethod` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `claimReference` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `claimDecidedAt` DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS `claimDecidedById` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `claimNote` TEXT NULL;

CREATE INDEX IF NOT EXISTS `StockLossShare_bearer_claimStatus_idx` ON `StockLossShare`(`bearer`, `claimStatus`);

UPDATE `KonsiTransfer` SET `receivedAt` = `createdAt` WHERE `status` = 'RECEIVED' AND `receivedAt` IS NULL;

UPDATE `KonsiTransferLine` l
  JOIN `KonsiTransfer` t ON t.`id` = l.`transferId`
  SET l.`receivedQty` = ROUND(l.`qty`)
  WHERE t.`status` = 'RECEIVED' AND l.`receivedQty` IS NULL;
