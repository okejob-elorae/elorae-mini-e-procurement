-- WO lead-time columns (PR4) + confirmation provenance (PR6)
ALTER TABLE `WorkOrder`
    ADD COLUMN `chainSnapshot` JSON NULL,
    ADD COLUMN `chainTotalDays` INTEGER NULL,
    ADD COLUMN `chainConfirmedStepIndex` INTEGER NULL,
    ADD COLUMN `chainConfirmedAt` DATETIME(3) NULL,
    ADD COLUMN `chainConfirmedSource` VARCHAR(191) NULL,
    ADD COLUMN `actualLeadDays` INTEGER NULL;

ALTER TABLE `PurchaseOrder`
    ADD COLUMN `chainConfirmedSource` VARCHAR(191) NULL;

-- ProcessTemplate SOP fields (PR5)
ALTER TABLE `ProcessTemplate`
    ADD COLUMN `isApproval` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `sopInstructions` TEXT NULL;

-- ChainTemplate SOP library (PR5)
CREATE TABLE `ChainTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ChainTemplate_name_key`(`name`),
    INDEX `ChainTemplate_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ChainTemplateStep` (
    `id` VARCHAR(191) NOT NULL,
    `chainTemplateId` VARCHAR(191) NOT NULL,
    `processTemplateId` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `notes` VARCHAR(191) NULL,

    INDEX `ChainTemplateStep_processTemplateId_idx`(`processTemplateId`),
    INDEX `ChainTemplateStep_chainTemplateId_idx`(`chainTemplateId`),
    UNIQUE INDEX `ChainTemplateStep_chainTemplateId_sequence_key`(`chainTemplateId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ChainTemplateStep` ADD CONSTRAINT `ChainTemplateStep_chainTemplateId_fkey` FOREIGN KEY (`chainTemplateId`) REFERENCES `ChainTemplate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ChainTemplateStep` ADD CONSTRAINT `ChainTemplateStep_processTemplateId_fkey` FOREIGN KEY (`processTemplateId`) REFERENCES `ProcessTemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
