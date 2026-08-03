-- AlterTable
ALTER TABLE `FieldSalesOrderLine` ADD COLUMN `requestedUnitPrice` DECIMAL(15, 2) NULL,
    ADD COLUMN `appealReason` VARCHAR(191) NULL;
