-- Collection submission: a field collector's claim to have collected against a receivable.
-- Moves no money -- Receivable.paidAmount/outstandingAmount are untouched until an admin
-- verifies it, which is the only moment recordPayment runs. See
-- docs/superpowers/specs/2026-08-27-collector-assignment-design.md.
--
-- Receivable.collectorId is a plain workflow column, not a separate assignment table -- there is
-- no terminal assignment state and no per-attempt data; every lifecycle state lives on the
-- submission. NULL means unassigned, the default for every existing receivable.
--
-- Re-runnable: a migration recorded as failed blocks every later deploy until
-- `prisma migrate resolve --rolled-back 20260827130000_add_collection_submission`. No FOREIGN
-- KEY: relationMode = "prisma". Additive, no backfill.

CREATE TABLE IF NOT EXISTS `CollectionSubmission` (
  `id` VARCHAR(191) NOT NULL,
  `receivableId` VARCHAR(191) NOT NULL,
  `collectorId` VARCHAR(191) NOT NULL,
  `amount` DECIMAL(15, 2) NOT NULL,
  `method` ENUM('CASH', 'TRANSFER') NOT NULL,
  `paidAt` DATETIME(3) NOT NULL,
  `note` TEXT NULL,
  `proofUrl` VARCHAR(191) NULL,
  `proofR2Key` VARCHAR(191) NULL,
  `status` ENUM('PENDING', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `paymentId` VARCHAR(191) NULL,
  `verifiedById` VARCHAR(191) NULL,
  `verifiedAt` DATETIME(3) NULL,
  `rejectReason` TEXT NULL,
  `idempotencyKey` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `CollectionSubmission_paymentId_key`(`paymentId`),
  UNIQUE INDEX `CollectionSubmission_idempotencyKey_key`(`idempotencyKey`),
  INDEX `CollectionSubmission_status_createdAt_idx`(`status`, `createdAt`),
  INDEX `CollectionSubmission_receivableId_idx`(`receivableId`),
  INDEX `CollectionSubmission_collectorId_status_idx`(`collectorId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Receivable` ADD COLUMN IF NOT EXISTS `collectorId` VARCHAR(191) NULL;
ALTER TABLE `Receivable` ADD INDEX IF NOT EXISTS `Receivable_collectorId_status_idx`(`collectorId`, `status`);
