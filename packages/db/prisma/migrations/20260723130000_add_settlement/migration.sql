-- CreateTable
CREATE TABLE `Settlement` (
    `id` VARCHAR(191) NOT NULL,
    `marketplace` VARCHAR(191) NOT NULL,
    `seller` VARCHAR(191) NOT NULL,
    `periodFrom` DATETIME(3) NOT NULL,
    `periodTo` DATETIME(3) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `uploadedById` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PARSED',
    `totalPendapatan` DECIMAL(18, 2) NOT NULL,
    `totalPengeluaran` DECIMAL(18, 2) NOT NULL,
    `totalDilepas` DECIMAL(18, 2) NOT NULL,
    `parsedNetTotal` DECIMAL(18, 2) NOT NULL,
    `checksumOk` BOOLEAN NOT NULL,
    `checksumVariance` DECIMAL(18, 2) NOT NULL,
    `summaryRaw` JSON NOT NULL,
    `sellerFeesRaw` JSON NOT NULL,
    `adjustmentsRaw` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Settlement_marketplace_periodFrom_idx`(`marketplace`, `periodFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SettlementLine` (
    `id` VARCHAR(191) NOT NULL,
    `settlementId` VARCHAR(191) NOT NULL,
    `orderNo` VARCHAR(191) NOT NULL,
    `netIncome` DECIMAL(18, 2) NOT NULL,
    `hargaAsliProduk` DECIMAL(18, 2) NOT NULL,
    `totalDiskonProduk` DECIMAL(18, 2) NOT NULL,
    `biayaAdministrasi` DECIMAL(18, 2) NOT NULL,
    `biayaLayanan` DECIMAL(18, 2) NOT NULL,
    `biayaKomisiAms` DECIMAL(18, 2) NOT NULL,
    `biayaProsesPesanan` DECIMAL(18, 2) NOT NULL,
    `raw` JSON NOT NULL,
    `matchStatus` VARCHAR(191) NOT NULL DEFAULT 'UNMATCHED',
    `matchedSalesOrderId` VARCHAR(191) NULL,
    `cogsSnapshot` DECIMAL(18, 2) NULL,
    `profit` DECIMAL(18, 2) NULL,

    INDEX `SettlementLine_settlementId_idx`(`settlementId`),
    INDEX `SettlementLine_orderNo_idx`(`orderNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SettlementLine` ADD CONSTRAINT `SettlementLine_settlementId_fkey` FOREIGN KEY (`settlementId`) REFERENCES `Settlement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
