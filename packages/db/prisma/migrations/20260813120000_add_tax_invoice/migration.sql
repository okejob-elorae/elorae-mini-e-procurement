-- Faktur pajak tracking: one row per nota tagihan (FieldSalesDelivery), created with the
-- delivery from now on and backfilled here for every delivery that already exists.
--
-- No FOREIGN KEY is declared: these relations are `relationMode = "prisma"`, and the unique
-- index on deliveryId is what enforces the one-row-per-delivery invariant this design relies on.
--
-- This file is RE-RUNNABLE, which makes RECOVERY safe — it does NOT make a failed deploy self-heal.
-- MariaDB auto-commits DDL, so a CREATE TABLE that succeeds followed by a failing backfill (a
-- lock-wait timeout against a concurrently-written FieldSalesDelivery is the realistic case) leaves
-- the table in place with the migration recorded FAILED. From then on `migrate deploy` refuses to
-- apply anything at all — including unrelated later migrations — until that record is resolved, and
-- the deploy job is gated on the migrate job, so every deploy is blocked. Nothing clears it on its
-- own. Recovery is `prisma migrate resolve --rolled-back 20260813120000_add_tax_invoice`, then
-- re-run the deploy: IF NOT EXISTS plus the NOT EXISTS-guarded INSERT mean that re-run neither
-- fails on the existing table nor double-inserts the rows already backfilled.
--
-- The INSERT alone may also be run standalone at any time, which is the post-deploy step recorded in
-- CLAUDE.md: it picks up deliveries created after this migration ran but before the app image that
-- writes the row went live.

CREATE TABLE IF NOT EXISTS `TaxInvoice` (
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
