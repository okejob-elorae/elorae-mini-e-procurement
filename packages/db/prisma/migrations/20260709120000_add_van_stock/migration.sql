-- CreateTable
CREATE TABLE `VanStock` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NULL,
    `qty` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `avgCost` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `VanStock_userId_idx`(`userId`),
    UNIQUE INDEX `VanStock_userId_itemId_variantSku_key`(`userId`, `itemId`, `variantSku`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VanLoad` (
    `id` VARCHAR(191) NOT NULL,
    `docNo` VARCHAR(191) NOT NULL,
    `canvasserId` VARCHAR(191) NOT NULL,
    `loadedById` VARCHAR(191) NOT NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `VanLoad_docNo_key`(`docNo`),
    INDEX `VanLoad_canvasserId_createdAt_idx`(`canvasserId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VanLoadLine` (
    `id` VARCHAR(191) NOT NULL,
    `vanLoadId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NULL,
    `qty` DECIMAL(10, 2) NOT NULL,
    `unitCost` DECIMAL(15, 2) NOT NULL,

    INDEX `VanLoadLine_vanLoadId_idx`(`vanLoadId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable (DocType enum += VANLOAD)
ALTER TABLE `DocNumberConfig` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD') NOT NULL;
ALTER TABLE `DocumentNumber` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD') NOT NULL;
