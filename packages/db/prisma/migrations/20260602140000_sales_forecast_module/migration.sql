-- CreateTable
CREATE TABLE `SalesHistoryImport` (
    `id` VARCHAR(191) NOT NULL,
    `channel` ENUM('SHOPEE', 'TIKTOK') NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `periodMonth` INTEGER NOT NULL,
    `periodYear` INTEGER NOT NULL,
    `totalRows` INTEGER NOT NULL,
    `importedRows` INTEGER NOT NULL,
    `skippedRows` INTEGER NOT NULL DEFAULT 0,
    `errorRows` INTEGER NOT NULL DEFAULT 0,
    `errors` JSON NULL,
    `uploadedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SalesHistoryImport_channel_periodYear_periodMonth_key`(`channel`, `periodYear`, `periodMonth`),
    INDEX `SalesHistoryImport_uploadedById_idx`(`uploadedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesHistory` (
    `id` VARCHAR(191) NOT NULL,
    `channel` ENUM('SHOPEE', 'TIKTOK') NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `orderStatus` ENUM('COMPLETED', 'CANCELLED', 'RETURNED') NOT NULL,
    `variantSku` VARCHAR(191) NOT NULL,
    `parentSku` VARCHAR(191) NOT NULL,
    `productName` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NULL,
    `size` VARCHAR(191) NULL,
    `quantity` INTEGER NOT NULL,
    `returnedQuantity` INTEGER NOT NULL DEFAULT 0,
    `netQuantity` INTEGER NOT NULL,
    `unitPrice` DECIMAL(15, 2) NOT NULL,
    `unitPriceAfterDiscount` DECIMAL(15, 2) NOT NULL,
    `lineTotal` DECIMAL(15, 2) NOT NULL,
    `orderTotal` DECIMAL(15, 2) NOT NULL,
    `orderDate` DATETIME(3) NOT NULL,
    `completedDate` DATETIME(3) NULL,
    `province` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `productCategory` VARCHAR(191) NULL,
    `importBatchId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SalesHistory_channel_orderId_variantSku_key`(`channel`, `orderId`, `variantSku`),
    INDEX `SalesHistory_parentSku_orderDate_idx`(`parentSku`, `orderDate`),
    INDEX `SalesHistory_orderDate_idx`(`orderDate`),
    INDEX `SalesHistory_channel_idx`(`channel`),
    INDEX `SalesHistory_importBatchId_idx`(`importBatchId`),
    INDEX `SalesHistory_orderStatus_idx`(`orderStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ForecastConfig` (
    `id` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `growthFactorPercent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `lookbackMonths` INTEGER NOT NULL DEFAULT 12,
    `weightDecay` DECIMAL(3, 2) NOT NULL DEFAULT 0.90,
    `notes` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ForecastConfig_year_key`(`year`),
    INDEX `ForecastConfig_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ForecastResult` (
    `id` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `parentSku` VARCHAR(191) NOT NULL,
    `productName` VARCHAR(191) NOT NULL,
    `abcClass` ENUM('A', 'B', 'C') NOT NULL,
    `xyzClass` ENUM('X', 'Y', 'Z') NOT NULL,
    `totalHistoricalQty` INTEGER NOT NULL,
    `totalHistoricalRevenue` DECIMAL(15, 2) NOT NULL,
    `avgMonthlyDemand` DECIMAL(10, 2) NOT NULL,
    `coefficientOfVariation` DECIMAL(5, 4) NOT NULL,
    `forecastMonth1` INTEGER NOT NULL DEFAULT 0,
    `forecastMonth2` INTEGER NOT NULL DEFAULT 0,
    `forecastMonth3` INTEGER NOT NULL DEFAULT 0,
    `forecastMonth4` INTEGER NOT NULL DEFAULT 0,
    `forecastMonth5` INTEGER NOT NULL DEFAULT 0,
    `forecastMonth6` INTEGER NOT NULL DEFAULT 0,
    `forecastMonth7` INTEGER NOT NULL DEFAULT 0,
    `forecastMonth8` INTEGER NOT NULL DEFAULT 0,
    `forecastMonth9` INTEGER NOT NULL DEFAULT 0,
    `forecastMonth10` INTEGER NOT NULL DEFAULT 0,
    `forecastMonth11` INTEGER NOT NULL DEFAULT 0,
    `forecastMonth12` INTEGER NOT NULL DEFAULT 0,
    `forecastAnnual` INTEGER NOT NULL DEFAULT 0,
    `seasonalIndex1` DECIMAL(5, 4) NOT NULL DEFAULT 1,
    `seasonalIndex2` DECIMAL(5, 4) NOT NULL DEFAULT 1,
    `seasonalIndex3` DECIMAL(5, 4) NOT NULL DEFAULT 1,
    `seasonalIndex4` DECIMAL(5, 4) NOT NULL DEFAULT 1,
    `seasonalIndex5` DECIMAL(5, 4) NOT NULL DEFAULT 1,
    `seasonalIndex6` DECIMAL(5, 4) NOT NULL DEFAULT 1,
    `seasonalIndex7` DECIMAL(5, 4) NOT NULL DEFAULT 1,
    `seasonalIndex8` DECIMAL(5, 4) NOT NULL DEFAULT 1,
    `seasonalIndex9` DECIMAL(5, 4) NOT NULL DEFAULT 1,
    `seasonalIndex10` DECIMAL(5, 4) NOT NULL DEFAULT 1,
    `seasonalIndex11` DECIMAL(5, 4) NOT NULL DEFAULT 1,
    `seasonalIndex12` DECIMAL(5, 4) NOT NULL DEFAULT 1,
    `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ForecastResult_year_parentSku_key`(`year`, `parentSku`),
    INDEX `ForecastResult_year_idx`(`year`),
    INDEX `ForecastResult_abcClass_xyzClass_idx`(`abcClass`, `xyzClass`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SalesHistory` ADD CONSTRAINT `SalesHistory_importBatchId_fkey` FOREIGN KEY (`importBatchId`) REFERENCES `SalesHistoryImport`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesHistoryImport` ADD CONSTRAINT `SalesHistoryImport_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `ForecastConfig` ADD CONSTRAINT `ForecastConfig_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
