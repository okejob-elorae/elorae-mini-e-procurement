-- CreateTable
CREATE TABLE `VanSale` (
    `id` VARCHAR(191) NOT NULL,
    `docNo` VARCHAR(191) NOT NULL,
    `salesmanId` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NULL,
    `buyerName` VARCHAR(191) NULL,
    `buyerPhone` VARCHAR(191) NULL,
    `saleLat` DECIMAL(10, 7) NULL,
    `saleLng` DECIMAL(10, 7) NULL,
    `subtotal` DECIMAL(15, 2) NOT NULL,
    `total` DECIMAL(15, 2) NOT NULL,
    `amountPaid` DECIMAL(15, 2) NOT NULL,
    `changeAmount` DECIMAL(15, 2) NOT NULL,
    `note` TEXT NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `VanSale_docNo_key`(`docNo`),
    UNIQUE INDEX `VanSale_idempotencyKey_key`(`idempotencyKey`),
    INDEX `VanSale_salesmanId_createdAt_idx`(`salesmanId`, `createdAt`),
    INDEX `VanSale_storeId_idx`(`storeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VanSaleLine` (
    `id` VARCHAR(191) NOT NULL,
    `vanSaleId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NULL,
    `productName` VARCHAR(191) NOT NULL,
    `qty` DECIMAL(10, 2) NOT NULL,
    `unitPrice` DECIMAL(15, 2) NOT NULL,
    `unitCost` DECIMAL(15, 2) NOT NULL,
    `lineTotal` DECIMAL(15, 2) NOT NULL,

    INDEX `VanSaleLine_vanSaleId_idx`(`vanSaleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable (DocType += VANSALE)
ALTER TABLE `DocNumberConfig` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE') NOT NULL;
ALTER TABLE `DocumentNumber` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE') NOT NULL;
