-- An approved konsi sell-through report can be voided: the report records who voided it, when and
-- why, its receivable becomes VOIDED and its faktur CANCELLED. Each status is a MySQL ENUM column,
-- so each is widened here with its full member list.
--
-- Re-runnable: the column adds are IF NOT EXISTS and each MODIFY restates the complete list.

ALTER TABLE `KonsiSellThrough` ADD COLUMN IF NOT EXISTS `voidedById` VARCHAR(191) NULL;
ALTER TABLE `KonsiSellThrough` ADD COLUMN IF NOT EXISTS `voidedAt` DATETIME(3) NULL;
ALTER TABLE `KonsiSellThrough` ADD COLUMN IF NOT EXISTS `voidReason` TEXT NULL;

ALTER TABLE `KonsiSellThrough`
  MODIFY COLUMN `status` ENUM('DRAFT', 'APPROVED', 'CANCELLED', 'VOIDED')
  NOT NULL DEFAULT 'DRAFT';

ALTER TABLE `Receivable`
  MODIFY COLUMN `status` ENUM('OUTSTANDING', 'PARTIAL', 'PAID', 'WRITTEN_OFF', 'VOIDED')
  NOT NULL DEFAULT 'OUTSTANDING';

ALTER TABLE `TaxInvoice`
  MODIFY COLUMN `status` ENUM('PENDING', 'CREATED', 'SENT_TO_STORE', 'NOT_REQUIRED', 'CANCELLED')
  NOT NULL DEFAULT 'PENDING';
