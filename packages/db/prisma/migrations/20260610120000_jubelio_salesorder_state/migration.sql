-- CreateTable
CREATE TABLE `JubelioSalesOrderState` (
    `id` VARCHAR(191) NOT NULL,
    `salesorderId` INTEGER NOT NULL,
    `stockApplied` BOOLEAN NOT NULL DEFAULT false,
    `lastStatus` VARCHAR(191) NULL,
    `lastIsCanceled` BOOLEAN NOT NULL DEFAULT false,
    `appliedAt` DATETIME(3) NULL,
    `reversedAt` DATETIME(3) NULL,
    `lastWebhookEventId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `JubelioSalesOrderState_salesorderId_key`(`salesorderId`),
    INDEX `JubelioSalesOrderState_lastWebhookEventId_idx`(`lastWebhookEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
