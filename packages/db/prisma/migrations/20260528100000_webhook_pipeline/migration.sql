-- AlterTable JubelioWebhookEvent
ALTER TABLE `JubelioWebhookEvent`
  ADD COLUMN `skipReason` VARCHAR(191) NULL,
  ADD COLUMN `deadAt` DATETIME(3) NULL,
  ADD COLUMN `lastEnqueuedAt` DATETIME(3) NULL;

-- AlterTable StockAdjustment — relax approver/creator + add webhook columns
ALTER TABLE `StockAdjustment` MODIFY `approvedById` VARCHAR(191) NULL;
ALTER TABLE `StockAdjustment` MODIFY `createdById` VARCHAR(191) NULL;
ALTER TABLE `StockAdjustment`
  ADD COLUMN `source` VARCHAR(191) NOT NULL DEFAULT 'ERP',
  ADD COLUMN `idempotencyKey` VARCHAR(191) NULL,
  ADD COLUMN `externalRef` VARCHAR(191) NULL;

-- Sparse unique on idempotencyKey
CREATE UNIQUE INDEX `StockAdjustment_idempotencyKey_key` ON `StockAdjustment`(`idempotencyKey`);
-- Filter index for source queries
CREATE INDEX `StockAdjustment_source_createdAt_idx` ON `StockAdjustment`(`source`, `createdAt`);

-- AlterTable JubelioProductMapping — make jubelioItemCode unique
CREATE UNIQUE INDEX `JubelioProductMapping_jubelioItemCode_key` ON `JubelioProductMapping`(`jubelioItemCode`);
