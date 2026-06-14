-- AlterTable
ALTER TABLE `SalesOrder`
    ADD COLUMN `fulfillmentStatus` ENUM('PENDING', 'PICKED', 'PACKED', 'SHIPPED') NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `pickedAt` DATETIME(3) NULL,
    ADD COLUMN `pickedById` VARCHAR(191) NULL,
    ADD COLUMN `packedAt` DATETIME(3) NULL,
    ADD COLUMN `packedById` VARCHAR(191) NULL,
    ADD COLUMN `shippedAt` DATETIME(3) NULL,
    ADD COLUMN `shippedById` VARCHAR(191) NULL,
    ADD COLUMN `shipmentJubelioId` INTEGER NULL,
    ADD COLUMN `courierId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `SalesOrder_fulfillmentStatus_idx` ON `SalesOrder`(`fulfillmentStatus`);
