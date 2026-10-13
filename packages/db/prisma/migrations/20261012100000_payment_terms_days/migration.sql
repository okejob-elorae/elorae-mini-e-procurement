-- Supplier payment terms in days, snapshotted onto each PO; NULL = not set.
ALTER TABLE `Supplier` ADD COLUMN `paymentTermsDays` INTEGER NULL;
ALTER TABLE `PurchaseOrder` ADD COLUMN `paymentTermsDays` INTEGER NULL;
