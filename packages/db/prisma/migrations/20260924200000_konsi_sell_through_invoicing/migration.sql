-- Approving a konsi sell-through report now invoices it: the report carries the invoice date,
-- due date and total, each line its unit price and line total, and a store's first report may be
-- approved as a no-invoice baseline instead.
--
-- Reports approved before invoicing existed carry no invoice, so they are marked baseline with a
-- fixed reason; the next report of their store opens from their closing figures as before.
--
-- Re-runnable: every column add is IF NOT EXISTS and the backfill only touches unmarked rows.

ALTER TABLE `KonsiSellThrough` ADD COLUMN IF NOT EXISTS `invoiceDate` DATETIME(3) NULL;
ALTER TABLE `KonsiSellThrough` ADD COLUMN IF NOT EXISTS `dueDate` DATETIME(3) NULL;
ALTER TABLE `KonsiSellThrough` ADD COLUMN IF NOT EXISTS `total` DECIMAL(15, 2) NULL;
ALTER TABLE `KonsiSellThrough` ADD COLUMN IF NOT EXISTS `baseline` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `KonsiSellThrough` ADD COLUMN IF NOT EXISTS `baselineReason` TEXT NULL;

ALTER TABLE `KonsiSellThroughLine` ADD COLUMN IF NOT EXISTS `unitPrice` DECIMAL(15, 2) NULL;
ALTER TABLE `KonsiSellThroughLine` ADD COLUMN IF NOT EXISTS `lineTotal` DECIMAL(15, 2) NULL;

UPDATE `KonsiSellThrough`
SET `baseline` = true, `baselineReason` = 'Approved before invoicing existed.'
WHERE `status` = 'APPROVED' AND `baseline` = false AND `invoiceDate` IS NULL;
