-- A field-sales order is either raised by a salesman at a store visit (FIELD) or pushed by an
-- admin from the backoffice (ADMIN). Every existing order was salesman-raised.
--
-- Re-runnable: the column add is IF NOT EXISTS.

ALTER TABLE `FieldSalesOrder` ADD COLUMN IF NOT EXISTS `origin` ENUM('FIELD', 'ADMIN') NOT NULL DEFAULT 'FIELD';
