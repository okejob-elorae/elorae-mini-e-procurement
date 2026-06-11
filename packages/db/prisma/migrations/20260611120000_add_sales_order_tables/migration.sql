-- AlterEnum
ALTER TABLE `SalesHistory` MODIFY `channel` ENUM('SHOPEE', 'TIKTOK', 'TOKOPEDIA', 'OTHER') NOT NULL;

-- CreateTable
CREATE TABLE `SalesOrder` (
    `id` VARCHAR(191) NOT NULL,
    `salesorderId` INTEGER NOT NULL,
    `salesorderNo` VARCHAR(191) NOT NULL,
    `channel` ENUM('SHOPEE', 'TIKTOK', 'TOKOPEDIA', 'OTHER') NOT NULL,
    `sourceName` VARCHAR(191) NOT NULL,
    `status` ENUM('NEW', 'PROCESSING', 'SHIPPED', 'COMPLETED', 'CANCELLED', 'RETURNED') NOT NULL,
    `channelStatus` VARCHAR(191) NULL,
    `internalStatus` VARCHAR(191) NULL,
    `wmsStatus` VARCHAR(191) NULL,
    `isCanceled` BOOLEAN NOT NULL DEFAULT false,
    `isPaid` BOOLEAN NOT NULL DEFAULT false,
    `markedAsComplete` BOOLEAN NOT NULL DEFAULT false,
    `customerName` VARCHAR(191) NULL,
    `customerPhone` VARCHAR(191) NULL,
    `customerEmail` VARCHAR(191) NULL,
    `shippingProvince` VARCHAR(191) NULL,
    `shippingCity` VARCHAR(191) NULL,
    `shippingAddress` JSON NULL,
    `subTotal` DECIMAL(15, 2) NOT NULL,
    `totalDisc` DECIMAL(15, 2) NOT NULL,
    `totalTax` DECIMAL(15, 2) NOT NULL,
    `shippingCost` DECIMAL(15, 2) NOT NULL,
    `grandTotal` DECIMAL(15, 2) NOT NULL,
    `feeBreakdown` JSON NULL,
    `paymentMethod` VARCHAR(191) NULL,
    `paymentDate` DATETIME(3) NULL,
    `transactionDate` DATETIME(3) NOT NULL,
    `createdDateJubelio` DATETIME(3) NULL,
    `completedDate` DATETIME(3) NULL,
    `cancelDate` DATETIME(3) NULL,
    `lastModifiedJubelio` DATETIME(3) NULL,
    `trackingNumber` VARCHAR(191) NULL,
    `courier` VARCHAR(191) NULL,
    `lastWebhookEventId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SalesOrder_salesorderId_key`(`salesorderId`),
    INDEX `SalesOrder_channel_idx`(`channel`),
    INDEX `SalesOrder_status_idx`(`status`),
    INDEX `SalesOrder_transactionDate_idx`(`transactionDate`),
    INDEX `SalesOrder_shippingProvince_idx`(`shippingProvince`),
    INDEX `SalesOrder_shippingCity_idx`(`shippingCity`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesOrderItem` (
    `id` VARCHAR(191) NOT NULL,
    `salesOrderId` VARCHAR(191) NOT NULL,
    `salesorderDetailId` INTEGER NOT NULL,
    `jubelioItemId` INTEGER NOT NULL,
    `jubelioItemCode` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `productName` VARCHAR(191) NOT NULL,
    `qty` DECIMAL(15, 4) NOT NULL,
    `qtyInBase` DECIMAL(15, 4) NOT NULL,
    `returnedQty` DECIMAL(15, 4) NOT NULL DEFAULT 0,
    `isCanceledItem` BOOLEAN NOT NULL DEFAULT false,
    `unitPrice` DECIMAL(15, 2) NOT NULL,
    `pricePaid` DECIMAL(15, 2) NOT NULL,
    `discAmount` DECIMAL(15, 2) NOT NULL,
    `taxAmount` DECIMAL(15, 2) NOT NULL,
    `lineTotal` DECIMAL(15, 2) NOT NULL,
    `discMarketplace` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `weightInGram` DECIMAL(15, 4) NOT NULL DEFAULT 0,

    UNIQUE INDEX `SalesOrderItem_salesorderDetailId_key`(`salesorderDetailId`),
    INDEX `SalesOrderItem_itemId_idx`(`itemId`),
    INDEX `SalesOrderItem_jubelioItemCode_idx`(`jubelioItemCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SalesOrderItem` ADD CONSTRAINT `SalesOrderItem_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
