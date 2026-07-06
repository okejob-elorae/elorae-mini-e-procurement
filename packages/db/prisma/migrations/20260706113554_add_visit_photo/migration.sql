-- CreateTable
CREATE TABLE `VisitPhoto` (
    `id` VARCHAR(191) NOT NULL,
    `visitId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `r2Key` VARCHAR(191) NOT NULL,
    `caption` VARCHAR(191) NULL,
    `capturedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `VisitPhoto_clientId_key`(`clientId`),
    INDEX `VisitPhoto_visitId_idx`(`visitId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

