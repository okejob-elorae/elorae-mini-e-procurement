-- CreateTable
CREATE TABLE `VanReconcile` (
    `id` VARCHAR(191) NOT NULL,
    `docNo` VARCHAR(191) NOT NULL,
    `canvasserId` VARCHAR(191) NOT NULL,
    `reconciledById` VARCHAR(191) NOT NULL,
    `note` TEXT NULL,
    `totalReturnedQty` DECIMAL(10, 2) NOT NULL,
    `totalVarianceQty` DECIMAL(10, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `VanReconcile_docNo_key`(`docNo`),
    INDEX `VanReconcile_canvasserId_createdAt_idx`(`canvasserId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VanReconcileLine` (
    `id` VARCHAR(191) NOT NULL,
    `vanReconcileId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NULL,
    `productName` VARCHAR(191) NOT NULL,
    `expectedQty` DECIMAL(10, 2) NOT NULL,
    `countedQty` DECIMAL(10, 2) NOT NULL,
    `varianceQty` DECIMAL(10, 2) NOT NULL,
    `unitCost` DECIMAL(15, 2) NOT NULL,

    INDEX `VanReconcileLine_vanReconcileId_idx`(`vanReconcileId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable (DocType += VANRECON)
ALTER TABLE `DocNumberConfig` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE', 'VANRECON') NOT NULL;
ALTER TABLE `DocumentNumber` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE', 'VANRECON') NOT NULL;
