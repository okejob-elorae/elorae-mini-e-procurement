-- CreateTable
CREATE TABLE `ProcessTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `leadTimeType` ENUM('FIXED', 'PER_QTY') NOT NULL DEFAULT 'FIXED',
    `days` INTEGER NOT NULL,
    `rateQty` INTEGER NULL,
    `notes` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProcessTemplate_name_key`(`name`),
    INDEX `ProcessTemplate_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SupplierProcess` (
    `id` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `processTemplateId` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `overrideDays` INTEGER NULL,
    `overrideRateQty` INTEGER NULL,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SupplierProcess_supplierId_idx`(`supplierId`),
    INDEX `SupplierProcess_processTemplateId_idx`(`processTemplateId`),
    UNIQUE INDEX `SupplierProcess_supplierId_sequence_key`(`supplierId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `PurchaseOrder`
    ADD COLUMN `chainSnapshot` JSON NULL,
    ADD COLUMN `chainTotalDays` INTEGER NULL,
    ADD COLUMN `chainConfirmedStepIndex` INTEGER NULL,
    ADD COLUMN `chainConfirmedAt` DATETIME(3) NULL,
    ADD COLUMN `actualLeadDays` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `SupplierProcess` ADD CONSTRAINT `SupplierProcess_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierProcess` ADD CONSTRAINT `SupplierProcess_processTemplateId_fkey` FOREIGN KEY (`processTemplateId`) REFERENCES `ProcessTemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
