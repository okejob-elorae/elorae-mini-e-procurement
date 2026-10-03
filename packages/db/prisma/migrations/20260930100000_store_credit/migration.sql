-- Store credit limits and the credit flag on field-sales orders.
-- See packages/db/prisma/postgres/migrations/16_kredit_toko for the rationale.
ALTER TABLE `Store` ADD COLUMN `creditLimit` DECIMAL(15, 2) NULL,
    ADD COLUMN `maxOpenInvoices` INTEGER NULL;
ALTER TABLE `FieldSalesOrder` ADD COLUMN `kreditDitahan` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `kreditCatatan` TEXT NULL;
