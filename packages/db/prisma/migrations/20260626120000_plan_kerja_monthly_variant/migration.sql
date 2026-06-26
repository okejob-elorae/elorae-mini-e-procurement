-- PlanYear lifecycle status (DRAFT | ACTIVE)
ALTER TABLE `PlanYear` ADD COLUMN `status` ENUM('DRAFT', 'ACTIVE') NOT NULL DEFAULT 'DRAFT';

-- PlanColorAllocation: migrate annual free-text rows to monthly variant rows (even split across 12 months)
CREATE TABLE `PlanColorAllocation_new` (
    `id` VARCHAR(191) NOT NULL,
    `planCategoryId` VARCHAR(191) NOT NULL,
    `month` INTEGER NOT NULL,
    `variantSku` VARCHAR(191) NOT NULL,
    `colorLabel` VARCHAR(191) NULL,
    `allocatedQty` INTEGER NOT NULL,
    `notes` VARCHAR(191) NULL,

    INDEX `PlanColorAllocation_planCategoryId_idx`(`planCategoryId`),
    UNIQUE INDEX `PlanColorAllocation_planCategoryId_month_variantSku_key`(`planCategoryId`, `month`, `variantSku`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `PlanColorAllocation_new` (`id`, `planCategoryId`, `month`, `variantSku`, `colorLabel`, `allocatedQty`, `notes`)
SELECT
    CONCAT('mig_pca_', SUBSTRING(`pca`.`id`, 1, 16), '_', `months`.`n`) AS `id`,
    `pca`.`planCategoryId`,
    `months`.`n` AS `month`,
    COALESCE(NULLIF(`pca`.`colorCode`, ''), `pca`.`colorName`) AS `variantSku`,
    `pca`.`colorName` AS `colorLabel`,
    FLOOR(`pca`.`allocatedQty` / 12) + IF(`months`.`n` <= (`pca`.`allocatedQty` % 12), 1, 0) AS `allocatedQty`,
    `pca`.`notes`
FROM `PlanColorAllocation` `pca`
CROSS JOIN (
    SELECT 1 AS `n` UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL
    SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL
    SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12
) `months`;

DROP TABLE `PlanColorAllocation`;
RENAME TABLE `PlanColorAllocation_new` TO `PlanColorAllocation`;

ALTER TABLE `PlanColorAllocation` ADD CONSTRAINT `PlanColorAllocation_planCategoryId_fkey` FOREIGN KEY (`planCategoryId`) REFERENCES `PlanCategory`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- PlanCmtAllocation: migrate annual vendor rows to monthly rows with legacy variant sentinel
CREATE TABLE `PlanCmtAllocation_new` (
    `id` VARCHAR(191) NOT NULL,
    `planCategoryId` VARCHAR(191) NOT NULL,
    `month` INTEGER NOT NULL,
    `variantSku` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `allocatedQty` INTEGER NOT NULL,
    `workOrderId` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,

    INDEX `PlanCmtAllocation_planCategoryId_idx`(`planCategoryId`),
    INDEX `PlanCmtAllocation_supplierId_idx`(`supplierId`),
    INDEX `PlanCmtAllocation_workOrderId_idx`(`workOrderId`),
    UNIQUE INDEX `PlanCmtAllocation_planCategoryId_month_variantSku_supplierId_key`(`planCategoryId`, `month`, `variantSku`, `supplierId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `PlanCmtAllocation_new` (`id`, `planCategoryId`, `month`, `variantSku`, `supplierId`, `allocatedQty`, `workOrderId`, `notes`)
SELECT
    CONCAT('mig_pcmt_', SUBSTRING(`pcmt`.`id`, 1, 16), '_', `months`.`n`) AS `id`,
    `pcmt`.`planCategoryId`,
    `months`.`n` AS `month`,
    '__LEGACY__' AS `variantSku`,
    `pcmt`.`supplierId`,
    FLOOR(`pcmt`.`allocatedQty` / 12) + IF(`months`.`n` <= (`pcmt`.`allocatedQty` % 12), 1, 0) AS `allocatedQty`,
    NULL AS `workOrderId`,
    `pcmt`.`notes`
FROM `PlanCmtAllocation` `pcmt`
CROSS JOIN (
    SELECT 1 AS `n` UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL
    SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL
    SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12
) `months`;

DROP TABLE `PlanCmtAllocation`;
RENAME TABLE `PlanCmtAllocation_new` TO `PlanCmtAllocation`;

ALTER TABLE `PlanCmtAllocation` ADD CONSTRAINT `PlanCmtAllocation_planCategoryId_fkey` FOREIGN KEY (`planCategoryId`) REFERENCES `PlanCategory`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE `PlanCmtAllocation` ADD CONSTRAINT `PlanCmtAllocation_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE `PlanCmtAllocation` ADD CONSTRAINT `PlanCmtAllocation_workOrderId_fkey` FOREIGN KEY (`workOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- PlanStage traceability for auto-synced WO rows
ALTER TABLE `PlanStage` ADD COLUMN `variantSku` VARCHAR(191) NULL;
ALTER TABLE `PlanStage` ADD COLUMN `planCmtAllocationId` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `PlanStage_planCmtAllocationId_key` ON `PlanStage`(`planCmtAllocationId`);

ALTER TABLE `PlanStage` ADD CONSTRAINT `PlanStage_planCmtAllocationId_fkey` FOREIGN KEY (`planCmtAllocationId`) REFERENCES `PlanCmtAllocation`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
