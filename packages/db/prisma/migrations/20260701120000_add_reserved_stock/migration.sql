-- AlterTable
ALTER TABLE `InventoryValue` ADD COLUMN `reservedQty` DECIMAL(10, 2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `StockReservation` (
    `id` VARCHAR(191) NOT NULL,
    `salesorderId` INTEGER NOT NULL,
    `salesorderDetailId` INTEGER NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
    `qty` DECIMAL(15, 4) NOT NULL,
    `state` ENUM('RESERVED', 'CONSUMED', 'RELEASED') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,

    UNIQUE INDEX `StockReservation_salesorderDetailId_key`(`salesorderDetailId`),
    INDEX `StockReservation_salesorderId_idx`(`salesorderId`),
    INDEX `StockReservation_state_idx`(`state`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

