-- AlterTable
ALTER TABLE `FieldSalesOrder` ADD COLUMN `idempotencyKey` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `FieldSalesOrder_idempotencyKey_key` ON `FieldSalesOrder`(`idempotencyKey`);

