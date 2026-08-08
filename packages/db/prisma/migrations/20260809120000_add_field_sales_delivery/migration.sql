-- AlterTable
ALTER TABLE `FieldSalesOrder` ADD COLUMN `deliveryStatus` ENUM('PENDING', 'PARTIAL', 'DELIVERED', 'CLOSED') NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE `FieldSalesOrderLine` ADD COLUMN `deliveredQty` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `cancelledQty` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `StockReservation` ADD COLUMN `consumedQty` DECIMAL(15, 4) NOT NULL DEFAULT 0;

-- AlterEnum
ALTER TABLE `DocNumberConfig` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE', 'VANRECON', 'SPGSALE', 'DELIVERY') NOT NULL;

-- CreateTable
CREATE TABLE `FieldSalesDelivery` (
    `id` VARCHAR(191) NOT NULL,
    `docNo` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `deliveredAt` DATETIME(3) NOT NULL,
    `deliveredById` VARCHAR(191) NOT NULL,
    `invoiceDate` DATETIME(3) NOT NULL,
    `dueDate` DATETIME(3) NOT NULL,
    `subtotal` DECIMAL(15, 2) NOT NULL,
    `discountAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `total` DECIMAL(15, 2) NOT NULL,
    `note` TEXT NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `FieldSalesDelivery_docNo_key`(`docNo`),
    UNIQUE INDEX `FieldSalesDelivery_idempotencyKey_key`(`idempotencyKey`),
    INDEX `FieldSalesDelivery_orderId_idx`(`orderId`),
    INDEX `FieldSalesDelivery_deliveredAt_idx`(`deliveredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FieldSalesDeliveryLine` (
    `id` VARCHAR(191) NOT NULL,
    `deliveryId` VARCHAR(191) NOT NULL,
    `orderLineId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
    `productName` VARCHAR(191) NOT NULL,
    `qty` INTEGER NOT NULL,
    `unitPrice` DECIMAL(15, 2) NULL,
    `discountAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `lineTotal` DECIMAL(15, 2) NULL,

    INDEX `FieldSalesDeliveryLine_deliveryId_idx`(`deliveryId`),
    INDEX `FieldSalesDeliveryLine_orderLineId_idx`(`orderLineId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `FieldSalesDelivery` ADD CONSTRAINT `FieldSalesDelivery_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `FieldSalesOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FieldSalesDelivery` ADD CONSTRAINT `FieldSalesDelivery_deliveredById_fkey` FOREIGN KEY (`deliveredById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FieldSalesDeliveryLine` ADD CONSTRAINT `FieldSalesDeliveryLine_deliveryId_fkey` FOREIGN KEY (`deliveryId`) REFERENCES `FieldSalesDelivery`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FieldSalesDeliveryLine` ADD CONSTRAINT `FieldSalesDeliveryLine_orderLineId_fkey` FOREIGN KEY (`orderLineId`) REFERENCES `FieldSalesOrderLine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FieldSalesDeliveryLine` ADD CONSTRAINT `FieldSalesDeliveryLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
