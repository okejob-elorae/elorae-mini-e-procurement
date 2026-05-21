-- AlterTable
ALTER TABLE `auditlog` ADD COLUMN `reason` VARCHAR(191) NULL,
    ADD COLUMN `sensitiveDataAccessed` VARCHAR(191) NULL,
    ADD COLUMN `userAgent` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `DocNumberConfig` (
    `id` VARCHAR(191) NOT NULL,
    `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT') NOT NULL,
    `prefix` VARCHAR(191) NOT NULL,
    `resetPeriod` VARCHAR(191) NOT NULL,
    `padding` INTEGER NOT NULL DEFAULT 4,
    `lastNumber` INTEGER NOT NULL DEFAULT 0,
    `year` INTEGER NOT NULL DEFAULT 0,
    `month` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `DocNumberConfig_docType_key`(`docType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NotificationQueue` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` VARCHAR(191) NOT NULL,
    `data` JSON NULL,
    `sent` BOOLEAN NOT NULL DEFAULT false,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `NotificationQueue_userId_sent_idx`(`userId`, `sent`),
    INDEX `NotificationQueue_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PinAttempt` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `success` BOOLEAN NOT NULL,
    `ipAddress` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PinAttempt_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
