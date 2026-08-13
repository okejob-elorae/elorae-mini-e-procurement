-- Faktur pajak tracking: one row per nota tagihan (FieldSalesDelivery), created with the
-- delivery from now on and backfilled here for every delivery that already exists.
--
-- No FOREIGN KEY is declared: these relations are `relationMode = "prisma"`, and the unique
-- index on deliveryId is what enforces the one-row-per-delivery invariant this design relies on.

CREATE TABLE `TaxInvoice` (
  `id` VARCHAR(191) NOT NULL,
  `deliveryId` VARCHAR(191) NOT NULL,
  `status` ENUM('PENDING', 'CREATED', 'NOT_REQUIRED') NOT NULL DEFAULT 'PENDING',
  `invoiceNo` VARCHAR(191) NULL,
  `markedAt` DATETIME(3) NULL,
  `markedById` VARCHAR(191) NULL,
  `reason` TEXT NULL,
  `notaPrintedAt` DATETIME(3) NULL,
  `notaPrintedById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `TaxInvoice_deliveryId_key`(`deliveryId`),
  INDEX `TaxInvoice_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Backfill. notaPrintedAt stays NULL even for notas printed before this feature: the print
-- history lives in AuditLog and is not reconstructed, so the next print of an old nota counts
-- as its first and notifies. That is intended — finance has never been told about any of them.
INSERT INTO `TaxInvoice` (`id`, `deliveryId`, `status`, `createdAt`, `updatedAt`)
SELECT REPLACE(UUID(), '-', ''), d.`id`, 'PENDING', NOW(3), NOW(3)
FROM `FieldSalesDelivery` d
WHERE NOT EXISTS (SELECT 1 FROM `TaxInvoice` t WHERE t.`deliveryId` = d.`id`);
