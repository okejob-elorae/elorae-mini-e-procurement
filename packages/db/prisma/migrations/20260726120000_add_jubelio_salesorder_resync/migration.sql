-- CreateTable
CREATE TABLE `JubelioSalesOrderResync` (
    `id` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `salesorderNo` VARCHAR(191) NOT NULL,
    `salesorderId` INTEGER NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastError` TEXT NULL,
    `webhookEventId` VARCHAR(191) NULL,
    `enqueuedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `JubelioSalesOrderResync_batchId_idx`(`batchId`),
    INDEX `JubelioSalesOrderResync_status_idx`(`status`),
    UNIQUE INDEX `JubelioSalesOrderResync_batchId_salesorderNo_key`(`batchId`, `salesorderNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
