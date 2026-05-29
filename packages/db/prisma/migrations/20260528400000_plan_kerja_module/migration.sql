-- CreateTable
CREATE TABLE `PlanYear` (
    `id` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `notes` TEXT NULL,
    `isLocked` BOOLEAN NOT NULL DEFAULT false,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PlanYear_year_key`(`year`),
    INDEX `PlanYear_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlanCategory` (
    `id` VARCHAR(191) NOT NULL,
    `planYearId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `parentId` VARCHAR(191) NULL,
    `targetQty` INTEGER NULL,
    `parentSharePercent` DECIMAL(5, 2) NULL,
    `itemId` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PlanCategory_planYearId_idx`(`planYearId`),
    INDEX `PlanCategory_parentId_idx`(`parentId`),
    INDEX `PlanCategory_itemId_idx`(`itemId`),
    UNIQUE INDEX `PlanCategory_planYearId_code_key`(`planYearId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlanMonthly` (
    `id` VARCHAR(191) NOT NULL,
    `planCategoryId` VARCHAR(191) NOT NULL,
    `month` INTEGER NOT NULL,
    `targetQty` INTEGER NULL,
    `isManualOverride` BOOLEAN NOT NULL DEFAULT false,
    `notes` VARCHAR(191) NULL,

    INDEX `PlanMonthly_planCategoryId_idx`(`planCategoryId`),
    UNIQUE INDEX `PlanMonthly_planCategoryId_month_key`(`planCategoryId`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlanStage` (
    `id` VARCHAR(191) NOT NULL,
    `planCategoryId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `targetQty` INTEGER NOT NULL,
    `targetMonth` INTEGER NULL,
    `supplierId` VARCHAR(191) NULL,
    `fabricNotes` VARCHAR(191) NULL,
    `colorNotes` VARCHAR(191) NULL,
    `workOrderId` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PlanStage_planCategoryId_idx`(`planCategoryId`),
    INDEX `PlanStage_supplierId_idx`(`supplierId`),
    INDEX `PlanStage_workOrderId_idx`(`workOrderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlanColorAllocation` (
    `id` VARCHAR(191) NOT NULL,
    `planCategoryId` VARCHAR(191) NOT NULL,
    `colorName` VARCHAR(191) NOT NULL,
    `colorCode` VARCHAR(191) NULL,
    `allocatedQty` INTEGER NOT NULL,
    `notes` VARCHAR(191) NULL,

    INDEX `PlanColorAllocation_planCategoryId_idx`(`planCategoryId`),
    UNIQUE INDEX `PlanColorAllocation_planCategoryId_colorName_key`(`planCategoryId`, `colorName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlanCmtAllocation` (
    `id` VARCHAR(191) NOT NULL,
    `planCategoryId` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `allocatedQty` INTEGER NOT NULL,
    `notes` VARCHAR(191) NULL,

    INDEX `PlanCmtAllocation_planCategoryId_idx`(`planCategoryId`),
    INDEX `PlanCmtAllocation_supplierId_idx`(`supplierId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlanAccessory` (
    `id` VARCHAR(191) NOT NULL,
    `planCategoryId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `qtyPerPcs` DECIMAL(10, 4) NOT NULL,
    `totalQtyNeeded` INTEGER NOT NULL,
    `notes` VARCHAR(191) NULL,

    INDEX `PlanAccessory_planCategoryId_idx`(`planCategoryId`),
    INDEX `PlanAccessory_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
