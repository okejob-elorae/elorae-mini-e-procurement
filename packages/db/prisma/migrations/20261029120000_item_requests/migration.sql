-- Request Item: material requests raised from a work order's BOM shortage (or by hand) and
-- converted line by line into purchase orders.

-- AlterTable
ALTER TABLE `DocNumberConfig` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE', 'VANRECON', 'SPGSALE', 'DELIVERY', 'FIELDRET', 'KONSITRF', 'STOCKTAKE', 'PAYMENT', 'BKM', 'STORETRF', 'SELLTHRU', 'ITEMREQ') NOT NULL;

-- AlterTable
ALTER TABLE `DocumentNumber` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE', 'VANRECON', 'SPGSALE', 'DELIVERY', 'FIELDRET', 'KONSITRF', 'STOCKTAKE', 'PAYMENT', 'BKM', 'STORETRF', 'SELLTHRU', 'ITEMREQ') NOT NULL;

-- CreateTable
CREATE TABLE `ItemRequest` (
    `id` VARCHAR(191) NOT NULL,
    `docNumber` VARCHAR(191) NOT NULL,
    `status` ENUM('OPEN', 'CONVERTED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `sourceWoId` VARCHAR(191) NULL,
    `neededBy` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ItemRequest_docNumber_key`(`docNumber`),
    INDEX `ItemRequest_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `ItemRequest_sourceWoId_idx`(`sourceWoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ItemRequestLine` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
    `qty` DECIMAL(10, 2) NOT NULL,
    `uomId` VARCHAR(191) NOT NULL,
    `status` ENUM('OPEN', 'CONVERTED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `poId` VARCHAR(191) NULL,
    `poItemId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ItemRequestLine_poItemId_key`(`poItemId`),
    INDEX `ItemRequestLine_requestId_idx`(`requestId`),
    INDEX `ItemRequestLine_status_idx`(`status`),
    INDEX `ItemRequestLine_itemId_idx`(`itemId`),
    INDEX `ItemRequestLine_poId_idx`(`poId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
