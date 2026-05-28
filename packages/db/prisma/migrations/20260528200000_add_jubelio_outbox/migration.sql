-- CreateTable
CREATE TABLE `JubelioOutbox` (
    `id` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastError` TEXT NULL,
    `skipReason` VARCHAR(191) NULL,
    `enqueuedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastEnqueuedAt` DATETIME(3) NULL,
    `processedAt` DATETIME(3) NULL,
    `deadAt` DATETIME(3) NULL,

    INDEX `JubelioOutbox_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `JubelioOutbox_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `JubelioOutbox_enqueuedById_idx`(`enqueuedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
