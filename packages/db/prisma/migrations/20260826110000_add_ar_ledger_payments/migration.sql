-- AR ledger + payment recording. `FieldSalesDelivery` is already the invoice (nota tagihan), so
-- `Receivable` hangs off it one-to-one and carries the denormalised collectible figures the aging
-- list and the (later) overdue sweep read without a join. `Payment` is a header with
-- `PaymentAllocation` lines, because a store settles one transfer against several notas at once.
--
-- `FieldSalesDelivery.cogsAmount` is nullable on purpose: it is written from the consume path's
-- avgCost at delivery time, and every pre-existing delivery legitimately has none, because the
-- value was never computed for it. A COGS journal for such a delivery resolves to NOTHING_TO_POST.
--
-- The backfill gives every existing delivery a Receivable at full outstanding — `paidAmount = 0` is
-- honest, no payment record exists for any of them. It deliberately posts NO journals: backdating
-- GL entries into periods that may already have been reported on is a finance decision, not a
-- migration's.
--
-- Re-runnable: a migration recorded as failed blocks every later deploy until
-- `prisma migrate resolve --rolled-back 20260826110000_add_ar_ledger_payments`, and idempotent SQL
-- is what makes re-running that recovery safe. No FOREIGN KEY: relationMode = "prisma".

-- Adding a DocType member is THREE places in SQL, not zero: the Prisma enum alone does not widen
-- the two ENUM COLUMNS that store it. Without these two MODIFYs, `generateDocNumber("PAYMENT")`
-- dies at the database with `Data truncated for column 'docType'` and the payment writer is dead on
-- arrival. Every prior DocType-adding migration carries this same pair — copy the full member list
-- from the newest one and append, never retype it from memory.
ALTER TABLE `DocNumberConfig` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE', 'VANRECON', 'SPGSALE', 'DELIVERY', 'FIELDRET', 'KONSITRF', 'STOCKTAKE', 'PAYMENT') NOT NULL;
ALTER TABLE `DocumentNumber` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE', 'VANRECON', 'SPGSALE', 'DELIVERY', 'FIELDRET', 'KONSITRF', 'STOCKTAKE', 'PAYMENT') NOT NULL;

ALTER TABLE `FieldSalesDelivery` ADD COLUMN IF NOT EXISTS `cogsAmount` DECIMAL(15, 2) NULL;

CREATE TABLE IF NOT EXISTS `Receivable` (
  `id` VARCHAR(191) NOT NULL,
  `deliveryId` VARCHAR(191) NOT NULL,
  `storeId` VARCHAR(191) NOT NULL,
  `invoiceDate` DATETIME(3) NOT NULL,
  `dueDate` DATETIME(3) NOT NULL,
  `originalAmount` DECIMAL(15, 2) NOT NULL,
  `paidAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
  `outstandingAmount` DECIMAL(15, 2) NOT NULL,
  `status` ENUM('OUTSTANDING', 'PARTIAL', 'PAID', 'WRITTEN_OFF') NOT NULL DEFAULT 'OUTSTANDING',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Receivable_deliveryId_key`(`deliveryId`),
  INDEX `Receivable_storeId_status_idx`(`storeId`, `status`),
  INDEX `Receivable_status_dueDate_idx`(`status`, `dueDate`),
  INDEX `Receivable_dueDate_idx`(`dueDate`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `Payment` (
  `id` VARCHAR(191) NOT NULL,
  `docNo` VARCHAR(191) NOT NULL,
  `storeId` VARCHAR(191) NOT NULL,
  `paidAt` DATETIME(3) NOT NULL,
  `method` ENUM('CASH', 'TRANSFER') NOT NULL,
  `amount` DECIMAL(15, 2) NOT NULL,
  `reference` VARCHAR(191) NULL,
  `proofUrl` VARCHAR(191) NULL,
  `proofR2Key` VARCHAR(191) NULL,
  `note` TEXT NULL,
  `status` ENUM('POSTED', 'VOIDED') NOT NULL DEFAULT 'POSTED',
  `recordedById` VARCHAR(191) NOT NULL,
  `voidedAt` DATETIME(3) NULL,
  `voidedById` VARCHAR(191) NULL,
  `voidReason` TEXT NULL,
  `idempotencyKey` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Payment_docNo_key`(`docNo`),
  UNIQUE INDEX `Payment_idempotencyKey_key`(`idempotencyKey`),
  INDEX `Payment_storeId_paidAt_idx`(`storeId`, `paidAt`),
  INDEX `Payment_status_paidAt_idx`(`status`, `paidAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `PaymentAllocation` (
  `id` VARCHAR(191) NOT NULL,
  `paymentId` VARCHAR(191) NOT NULL,
  `receivableId` VARCHAR(191) NOT NULL,
  `amount` DECIMAL(15, 2) NOT NULL,
  UNIQUE INDEX `PaymentAllocation_paymentId_receivableId_key`(`paymentId`, `receivableId`),
  INDEX `PaymentAllocation_receivableId_idx`(`receivableId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `Receivable`
  (`id`, `deliveryId`, `storeId`, `invoiceDate`, `dueDate`,
   `originalAmount`, `paidAmount`, `outstandingAmount`, `status`, `createdAt`, `updatedAt`)
SELECT UUID(), d.`id`, o.`storeId`, d.`invoiceDate`, d.`dueDate`,
       d.`total`, 0, d.`total`, 'OUTSTANDING', NOW(3), NOW(3)
FROM `FieldSalesDelivery` d
JOIN `FieldSalesOrder` o ON o.`id` = d.`orderId`
WHERE NOT EXISTS (SELECT 1 FROM `Receivable` r WHERE r.`deliveryId` = d.`id`);
