-- Vendor billing: vendor invoices matched to received PO items and WO processing steps, and the
-- group payments that settle them. Payments ship in a later PR; their tables land here so the
-- bill writer can already refuse to void a bill that has allocations.

-- AlterTable
ALTER TABLE `DocNumberConfig` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE', 'VANRECON', 'SPGSALE', 'DELIVERY', 'FIELDRET', 'KONSITRF', 'STOCKTAKE', 'PAYMENT', 'BKM', 'STORETRF', 'SELLTHRU', 'ITEMREQ', 'VENDOR_BILL', 'VENDOR_PAYMENT') NOT NULL;

-- AlterTable
ALTER TABLE `DocumentNumber` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE', 'VANRECON', 'SPGSALE', 'DELIVERY', 'FIELDRET', 'KONSITRF', 'STOCKTAKE', 'PAYMENT', 'BKM', 'STORETRF', 'SELLTHRU', 'ITEMREQ', 'VENDOR_BILL', 'VENDOR_PAYMENT') NOT NULL;

-- CreateTable
CREATE TABLE `VendorBill` (
    `id` VARCHAR(191) NOT NULL,
    `docNumber` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `vendorInvoiceNo` VARCHAR(191) NOT NULL,
    `billDate` DATETIME(3) NOT NULL,
    `dueDate` DATETIME(3) NULL,
    `total` DECIMAL(15, 2) NOT NULL,
    `paidAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `status` ENUM('UNPAID', 'PARTIAL', 'PAID', 'VOID') NOT NULL DEFAULT 'UNPAID',
    `notes` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `VendorBill_docNumber_key`(`docNumber`),
    INDEX `VendorBill_supplierId_status_idx`(`supplierId`, `status`),
    INDEX `VendorBill_billDate_idx`(`billDate`),
    UNIQUE INDEX `VendorBill_supplierId_vendorInvoiceNo_key`(`supplierId`, `vendorInvoiceNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VendorBillLine` (
    `id` VARCHAR(191) NOT NULL,
    `billId` VARCHAR(191) NOT NULL,
    `type` ENUM('PO_ITEM', 'WO_STEP') NOT NULL,
    `poItemId` VARCHAR(191) NULL,
    `woStepId` VARCHAR(191) NULL,
    `qty` DECIMAL(10, 2) NOT NULL,
    `price` DECIMAL(15, 2) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `refPrice` DECIMAL(15, 2) NOT NULL,

    INDEX `VendorBillLine_billId_idx`(`billId`),
    INDEX `VendorBillLine_poItemId_idx`(`poItemId`),
    INDEX `VendorBillLine_woStepId_idx`(`woStepId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VendorPayment` (
    `id` VARCHAR(191) NOT NULL,
    `docNumber` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `paidAt` DATETIME(3) NOT NULL,
    `method` ENUM('BANK', 'CASH') NOT NULL,
    `reference` VARCHAR(191) NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `notes` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `VendorPayment_docNumber_key`(`docNumber`),
    INDEX `VendorPayment_supplierId_paidAt_idx`(`supplierId`, `paidAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VendorPaymentAllocation` (
    `id` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `billId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,

    INDEX `VendorPaymentAllocation_billId_idx`(`billId`),
    UNIQUE INDEX `VendorPaymentAllocation_paymentId_billId_key`(`paymentId`, `billId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Real foreign keys, which `relationMode = "prisma"` would otherwise leave out (see
-- 20261021100000_field_sales_foreign_keys). ON DELETE matches the Prisma relations: CASCADE for a
-- document's own lines / allocations, SET NULL for the PO item link (`updatePO` rebuilds PO items
-- and refuses a PO with live bill lines, so only a voided bill's line can lose its link), RESTRICT
-- for the rest. All four tables are created empty above, so no orphan preflight is needed.

-- AddForeignKey
ALTER TABLE `VendorBill`
  ADD CONSTRAINT `VendorBill_supplierId_fkey` FOREIGN KEY IF NOT EXISTS (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `VendorBill_createdById_fkey` FOREIGN KEY IF NOT EXISTS (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VendorBillLine`
  ADD CONSTRAINT `VendorBillLine_billId_fkey` FOREIGN KEY IF NOT EXISTS (`billId`) REFERENCES `VendorBill`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `VendorBillLine_poItemId_fkey` FOREIGN KEY IF NOT EXISTS (`poItemId`) REFERENCES `POItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `VendorBillLine_woStepId_fkey` FOREIGN KEY IF NOT EXISTS (`woStepId`) REFERENCES `WorkOrderStep`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VendorPayment`
  ADD CONSTRAINT `VendorPayment_supplierId_fkey` FOREIGN KEY IF NOT EXISTS (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `VendorPayment_createdById_fkey` FOREIGN KEY IF NOT EXISTS (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VendorPaymentAllocation`
  ADD CONSTRAINT `VendorPaymentAllocation_paymentId_fkey` FOREIGN KEY IF NOT EXISTS (`paymentId`) REFERENCES `VendorPayment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `VendorPaymentAllocation_billId_fkey` FOREIGN KEY IF NOT EXISTS (`billId`) REFERENCES `VendorBill`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
