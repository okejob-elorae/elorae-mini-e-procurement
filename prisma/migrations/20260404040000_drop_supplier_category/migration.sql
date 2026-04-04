-- Remove SupplierCategory and supplier.categoryId (constraint names differ by deploy; disable checks briefly)
SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE `Supplier` DROP COLUMN `categoryId`;

DROP TABLE IF EXISTS `SupplierCategory`;

SET FOREIGN_KEY_CHECKS = 1;
