-- Lets a Receivable and a TaxInvoice come from either a putus FieldSalesDelivery or a konsi
-- sell-through report, instead of only the former. Widens both `deliveryId` columns to nullable
-- and adds a sibling `sellThroughId`, with a CHECK enforcing exactly one source is set -- Prisma
-- cannot express an XOR constraint, so it is hand-written here.
--
-- No backfill: every existing row already has `deliveryId` set and `sellThroughId` NULL, which
-- already satisfies the CHECK. No FK on either new column -- relationMode = "prisma".
--
-- `MODIFY ... NULL` keeps the existing unique index on each `deliveryId` column in MariaDB; it is
-- not dropped or recreated here.
--
-- Safe to re-run after a partial failure (MariaDB commits each DDL statement on its own): every
-- statement is idempotent, and each CHECK is dropped if present before it is added. Prisma still
-- records a partially applied migration as failed, so run
-- `prisma migrate resolve --rolled-back 20260924100000_receivable_source` before re-deploying.

ALTER TABLE `Receivable` MODIFY `deliveryId` VARCHAR(191) NULL;
ALTER TABLE `Receivable` ADD COLUMN IF NOT EXISTS `sellThroughId` VARCHAR(191) NULL;
CREATE UNIQUE INDEX IF NOT EXISTS `Receivable_sellThroughId_key` ON `Receivable`(`sellThroughId`);
ALTER TABLE `Receivable` DROP CONSTRAINT IF EXISTS `Receivable_one_source_check`;
ALTER TABLE `Receivable` ADD CONSTRAINT `Receivable_one_source_check` CHECK ((`deliveryId` IS NULL) <> (`sellThroughId` IS NULL));

ALTER TABLE `TaxInvoice` MODIFY `deliveryId` VARCHAR(191) NULL;
ALTER TABLE `TaxInvoice` ADD COLUMN IF NOT EXISTS `sellThroughId` VARCHAR(191) NULL;
CREATE UNIQUE INDEX IF NOT EXISTS `TaxInvoice_sellThroughId_key` ON `TaxInvoice`(`sellThroughId`);
ALTER TABLE `TaxInvoice` DROP CONSTRAINT IF EXISTS `TaxInvoice_one_source_check`;
ALTER TABLE `TaxInvoice` ADD CONSTRAINT `TaxInvoice_one_source_check` CHECK ((`deliveryId` IS NULL) <> (`sellThroughId` IS NULL));

ALTER TABLE `KonsiSellThrough` ADD COLUMN IF NOT EXISTS `salesmanId` VARCHAR(191) NULL;
CREATE INDEX IF NOT EXISTS `KonsiSellThrough_salesmanId_idx` ON `KonsiSellThrough`(`salesmanId`);
