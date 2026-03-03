-- CreateTable
CREATE TABLE `RejectedGoodsLedger` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `qty` DECIMAL(10, 2) NOT NULL,
    `refType` VARCHAR(191) NOT NULL,
    `refId` VARCHAR(191) NOT NULL,
    `refDocNumber` VARCHAR(191) NOT NULL,
    `woId` VARCHAR(191) NULL,
    `receivedAt` DATETIME(3) NOT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RejectedGoodsLedger_itemId_idx`(`itemId`),
    INDEX `RejectedGoodsLedger_refType_refId_idx`(`refType`, `refId`),
    INDEX `RejectedGoodsLedger_woId_idx`(`woId`),
    INDEX `RejectedGoodsLedger_receivedAt_idx`(`receivedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RejectedGoodsLedger` ADD CONSTRAINT `RejectedGoodsLedger_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
