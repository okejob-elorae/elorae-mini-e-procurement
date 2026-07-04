-- AlterTable
ALTER TABLE `Item` ADD COLUMN `minOrderQty` INTEGER NULL;

-- AlterTable
ALTER TABLE `SalesHistory`
    MODIFY `channel` ENUM('SHOPEE', 'TIKTOK', 'TOKOPEDIA', 'OTHER', 'OFFLINE') NOT NULL,
    MODIFY `importBatchId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `SalesHistoryImport` MODIFY `channel` ENUM('SHOPEE', 'TIKTOK', 'TOKOPEDIA', 'OTHER', 'OFFLINE') NOT NULL;

-- AlterTable
ALTER TABLE `SalesOrder` MODIFY `channel` ENUM('SHOPEE', 'TIKTOK', 'TOKOPEDIA', 'OTHER', 'OFFLINE') NOT NULL;

-- AlterTable
ALTER TABLE `SalesReturn` MODIFY `channel` ENUM('SHOPEE', 'TIKTOK', 'TOKOPEDIA', 'OTHER', 'OFFLINE') NOT NULL;

-- AlterTable
ALTER TABLE `StockReservation`
    ADD COLUMN `source` ENUM('JUBELIO', 'FIELD_SALES') NOT NULL DEFAULT 'JUBELIO',
    ADD COLUMN `fieldSalesLineId` VARCHAR(191) NULL,
    MODIFY `salesorderId` INTEGER NULL,
    MODIFY `salesorderDetailId` INTEGER NULL;

-- CreateTable
CREATE TABLE `FieldSalesOrder` (
    `id` VARCHAR(191) NOT NULL,
    `orderNo` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `salesmanId` VARCHAR(191) NOT NULL,
    `visitId` VARCHAR(191) NULL,
    `status` ENUM('PENDING_APPROVAL', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING_APPROVAL',
    `subtotal` DECIMAL(15, 2) NOT NULL,
    `total` DECIMAL(15, 2) NOT NULL,
    `note` TEXT NULL,
    `approvedAt` DATETIME(3) NULL,
    `approvedById` VARCHAR(191) NULL,
    `rejectedAt` DATETIME(3) NULL,
    `rejectedById` VARCHAR(191) NULL,
    `rejectReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FieldSalesOrder_orderNo_key`(`orderNo`),
    INDEX `FieldSalesOrder_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `FieldSalesOrder_storeId_createdAt_idx`(`storeId`, `createdAt`),
    INDEX `FieldSalesOrder_salesmanId_createdAt_idx`(`salesmanId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FieldSalesOrderLine` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
    `productName` VARCHAR(191) NOT NULL,
    `qty` INTEGER NOT NULL,
    `unitPrice` DECIMAL(15, 2) NOT NULL,
    `lineTotal` DECIMAL(15, 2) NOT NULL,

    INDEX `FieldSalesOrderLine_orderId_idx`(`orderId`),
    INDEX `FieldSalesOrderLine_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `StockReservation_fieldSalesLineId_key` ON `StockReservation`(`fieldSalesLineId`);
