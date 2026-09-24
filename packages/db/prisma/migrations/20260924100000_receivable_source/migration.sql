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

ALTER TABLE `Receivable` MODIFY `deliveryId` VARCHAR(191) NULL;
ALTER TABLE `Receivable` ADD COLUMN `sellThroughId` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `Receivable_sellThroughId_key` ON `Receivable`(`sellThroughId`);
ALTER TABLE `Receivable` ADD CONSTRAINT `Receivable_one_source_check` CHECK ((`deliveryId` IS NULL) <> (`sellThroughId` IS NULL));

ALTER TABLE `TaxInvoice` MODIFY `deliveryId` VARCHAR(191) NULL;
ALTER TABLE `TaxInvoice` ADD COLUMN `sellThroughId` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `TaxInvoice_sellThroughId_key` ON `TaxInvoice`(`sellThroughId`);
ALTER TABLE `TaxInvoice` ADD CONSTRAINT `TaxInvoice_one_source_check` CHECK ((`deliveryId` IS NULL) <> (`sellThroughId` IS NULL));

ALTER TABLE `KonsiSellThrough` ADD COLUMN `salesmanId` VARCHAR(191) NULL;
CREATE INDEX `KonsiSellThrough_salesmanId_idx` ON `KonsiSellThrough`(`salesmanId`);
