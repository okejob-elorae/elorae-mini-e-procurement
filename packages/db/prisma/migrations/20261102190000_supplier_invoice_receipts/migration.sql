-- Supplier invoices name the RECEIPTS they bill, price differences wait for a decision, invoices are
-- asked for, and a goods receipt without a PO waits for the admin (owner decisions 2026-10-29
-- "admin MEMILIH penerimaan barang mana saja yang ditagih", 2026-11-02 P19, P20, P27, P29, P49, P50,
-- P51/P51a, P52, P53).
--
-- VendorBillLine.type gains GRN_ITEM: one line per (GRN, item + trimmed variant). grnId/itemId/variantSku
-- name the receipt key the line bills. PO_ITEM is never written by the new image; a PO_ITEM line the
-- old image writes in the deploy window has grnId NULL and covers nothing (it reads unpaid and is not
-- counted as billed on any GRN). No supplier receipt has ever been made for real, so none is expected.
-- Read-only post-deploy check (expect 0):
--   SELECT COUNT(*) FROM `VendorBillLine` WHERE `type` = 'PO_ITEM' AND `grnId` IS NULL
--     AND `billId` IN (SELECT `id` FROM `VendorBill` WHERE `status` <> 'VOID');
--
-- GRN.requiresNoPoConfirmation: a GRN saved WITHOUT a PO is stored but moves no stock and books no
-- payable until an admin confirms it (`goods_receipts:confirm_no_po`, P51a: "tidak usah di hapus, tapi
-- ada konfirmasi dari admin saja"). The column DEFAULT false IS the backfill: every existing GRN stays
-- processed, and a no-PO GRN the old image saves in the deploy window lands false and is processed the
-- old way. noPoConfirmedAt/noPoConfirmedById stamp the confirmation. Declining is NOT built this round
-- (owner question pending), so there is no decline column.
--
-- SupplierPayableCorrection: an invoice price that differs from the receipt's recorded payable, higher
-- or lower, is one row MENUNGGU; the whole receipt cannot be paid until it is DITERIMA (payable and the
-- receipt's HPP corrected) or INVOICE_DIKOREKSI (invoice taken at the receipt price, only when it is
-- higher). DIBATALKAN when its bill is voided. `breakdown` holds one entry per (receipt document, item,
-- variant) with the inventory and PPN parts.
--
-- SupplierInvoiceRequest / SupplierInvoiceRequestLine: "Minta invoice" — who asked, when, through which
-- channel, for which receipts (one line per GRN or WO step), with the qty and value snapshot. Status is
-- derived; closedAt is only a cache. remindedAt marks the single 7-day reminder (re-armed by a follow-up).
--
-- SupplierInvoiceWaiver: "Tidak perlu invoice" with a required reason (P52), per GRN key or WO step,
-- reversible (cancelledAt). It changes no payable.
--
-- No FOREIGN KEY on the new columns and tables (relationMode = "prisma"). Additive and re-runnable
-- (IF NOT EXISTS); safe while the old image still runs, which never reads the new columns or tables.

ALTER TABLE `VendorBillLine` MODIFY `type` ENUM('PO_ITEM', 'WO_STEP', 'GRN_ITEM') NOT NULL;

ALTER TABLE `VendorBillLine`
  ADD COLUMN IF NOT EXISTS `grnId` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `itemId` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `variantSku` VARCHAR(191) NULL;

CREATE INDEX IF NOT EXISTS `VendorBillLine_grnId_idx` ON `VendorBillLine`(`grnId`);
CREATE INDEX IF NOT EXISTS `VendorBillLine_grnId_itemId_idx` ON `VendorBillLine`(`grnId`, `itemId`);

ALTER TABLE `GRN`
  ADD COLUMN IF NOT EXISTS `requiresNoPoConfirmation` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS `noPoConfirmedAt` DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS `noPoConfirmedById` VARCHAR(191) NULL;

CREATE INDEX IF NOT EXISTS `GRN_requiresNoPoConfirmation_noPoConfirmedAt_idx` ON `GRN`(`requiresNoPoConfirmation`, `noPoConfirmedAt`);

CREATE TABLE IF NOT EXISTS `SupplierPayableCorrection` (
    `id` VARCHAR(191) NOT NULL,
    `billId` VARCHAR(191) NOT NULL,
    `billLineId` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `sourceType` VARCHAR(10) NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `variantSku` VARCHAR(191) NULL,
    `qty` DECIMAL(10, 2) NOT NULL,
    `recordedPrice` DECIMAL(15, 2) NOT NULL,
    `invoicePrice` DECIMAL(15, 2) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `dppAmount` DECIMAL(15, 2) NOT NULL,
    `ppnInputAmount` DECIMAL(15, 2) NOT NULL,
    `inventoryAmount` DECIMAL(15, 2) NOT NULL,
    `stockAmount` DECIMAL(15, 2) NULL,
    `soldAmount` DECIMAL(15, 2) NULL,
    `breakdown` JSON NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'MENUNGGU',
    `decidedAt` DATETIME(3) NULL,
    `decidedById` VARCHAR(191) NULL,
    `decisionNote` TEXT NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelReason` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SupplierPayableCorrection_billLineId_key`(`billLineId`),
    INDEX `SupplierPayableCorrection_sourceType_sourceId_status_idx`(`sourceType`, `sourceId`, `status`),
    INDEX `SupplierPayableCorrection_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `SupplierPayableCorrection_billId_idx`(`billId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `SupplierInvoiceRequest` (
    `id` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(20) NOT NULL,
    `note` TEXT NULL,
    `requestedById` VARCHAR(191) NOT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastRequestedById` VARCHAR(191) NOT NULL,
    `lastRequestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `askCount` INTEGER NOT NULL DEFAULT 1,
    `remindedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `closedByBillId` VARCHAR(191) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelledById` VARCHAR(191) NULL,
    `cancelReason` TEXT NULL,
    `idempotencyKey` VARCHAR(100) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SupplierInvoiceRequest_idempotencyKey_key`(`idempotencyKey`),
    INDEX `SupplierInvoiceRequest_supplierId_cancelledAt_closedAt_idx`(`supplierId`, `cancelledAt`, `closedAt`),
    INDEX `SupplierInvoiceRequest_cancelledAt_closedAt_lastRequestedAt_idx`(`cancelledAt`, `closedAt`, `lastRequestedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `SupplierInvoiceRequestLine` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `sourceType` VARCHAR(10) NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `receivedQty` DECIMAL(12, 2) NOT NULL,
    `billedQty` DECIMAL(12, 2) NOT NULL,
    `qty` DECIMAL(12, 2) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `amountUnknown` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `SupplierInvoiceRequestLine_requestId_sourceType_sourceId_key`(`requestId`, `sourceType`, `sourceId`),
    INDEX `SupplierInvoiceRequestLine_sourceType_sourceId_idx`(`sourceType`, `sourceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `SupplierInvoiceWaiver` (
    `id` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `sourceType` VARCHAR(10) NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `variantSku` VARCHAR(191) NULL,
    `qty` DECIMAL(12, 2) NOT NULL,
    `reason` TEXT NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `cancelledAt` DATETIME(3) NULL,
    `cancelledById` VARCHAR(191) NULL,
    `cancelReason` TEXT NULL,

    INDEX `SupplierInvoiceWaiver_sourceType_sourceId_cancelledAt_idx`(`sourceType`, `sourceId`, `cancelledAt`),
    INDEX `SupplierInvoiceWaiver_supplierId_cancelledAt_idx`(`supplierId`, `cancelledAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
