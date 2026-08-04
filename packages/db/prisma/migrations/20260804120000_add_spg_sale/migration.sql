-- AlterTable
ALTER TABLE `User` ADD COLUMN `assignedStoreId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `User_assignedStoreId_idx` ON `User`(`assignedStoreId`);

-- CreateTable
CREATE TABLE `SpgSale` (
    `id` VARCHAR(191) NOT NULL,
    `docNo` VARCHAR(191) NOT NULL,
    `salesmanId` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `saleLat` DECIMAL(10, 7) NULL,
    `saleLng` DECIMAL(10, 7) NULL,
    `subtotal` DECIMAL(15, 2) NOT NULL,
    `total` DECIMAL(15, 2) NOT NULL,
    `cashReceived` DECIMAL(15, 2) NOT NULL,
    `changeGiven` DECIMAL(15, 2) NOT NULL,
    `note` TEXT NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SpgSale_docNo_key`(`docNo`),
    UNIQUE INDEX `SpgSale_idempotencyKey_key`(`idempotencyKey`),
    INDEX `SpgSale_salesmanId_createdAt_idx`(`salesmanId`, `createdAt`),
    INDEX `SpgSale_storeId_idx`(`storeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SpgSaleLine` (
    `id` VARCHAR(191) NOT NULL,
    `spgSaleId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
    `productName` VARCHAR(191) NOT NULL,
    `qty` INTEGER NOT NULL,
    `unitPrice` DECIMAL(15, 2) NOT NULL,
    `lineTotal` DECIMAL(15, 2) NOT NULL,

    INDEX `SpgSaleLine_spgSaleId_idx`(`spgSaleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable (DocType += SPGSALE)
ALTER TABLE `DocNumberConfig` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE', 'VANRECON', 'SPGSALE') NOT NULL;
ALTER TABLE `DocumentNumber` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN', 'PUTUS', 'KONSI', 'VANLOAD', 'VANSALE', 'VANRECON', 'SPGSALE') NOT NULL;
