ALTER TABLE `DocNumberConfig` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN') NOT NULL;
ALTER TABLE `DocumentNumber` MODIFY `docType` ENUM('PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT', 'OPN') NOT NULL;

CREATE TABLE `StockOpname` (
    `id` VARCHAR(191) NOT NULL,
    `docNumber` VARCHAR(191) NOT NULL,
    `scope` ENUM('FINISHED_GOOD', 'FABRIC', 'ACCESSORIES') NOT NULL,
    `status` ENUM('CREATED', 'COUNTING', 'SUBMITTED', 'APPROVED', 'CANCELLED') NOT NULL DEFAULT 'CREATED',
    `notes` TEXT NULL,
    `snapshotAt` DATETIME(3) NOT NULL,
    `assignedToId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `submittedById` VARCHAR(191) NULL,
    `submittedAt` DATETIME(3) NULL,
    `approvedById` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StockOpname_docNumber_key`(`docNumber`),
    INDEX `StockOpname_scope_idx`(`scope`),
    INDEX `StockOpname_status_idx`(`status`),
    INDEX `StockOpname_docNumber_idx`(`docNumber`),
    INDEX `StockOpname_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `StockOpnameItem` (
    `id` VARCHAR(191) NOT NULL,
    `opnameId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NULL,
    `itemName` VARCHAR(191) NOT NULL,
    `snapshotQty` DECIMAL(10, 2) NOT NULL,
    `countedQty` DECIMAL(10, 2) NULL,
    `variance` DECIMAL(10, 2) NULL,
    `currentQtyAtApproval` DECIMAL(10, 2) NULL,
    `hadDriftWarning` BOOLEAN NOT NULL DEFAULT false,
    `adjustmentId` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,

    INDEX `StockOpnameItem_opnameId_idx`(`opnameId`),
    INDEX `StockOpnameItem_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `StockOpnameRoll` (
    `id` VARCHAR(191) NOT NULL,
    `opnameId` VARCHAR(191) NOT NULL,
    `fabricRollId` VARCHAR(191) NOT NULL,
    `rollCode` VARCHAR(191) NOT NULL,
    `itemName` VARCHAR(191) NOT NULL,
    `snapshotLength` DECIMAL(10, 2) NOT NULL,
    `countedLength` DECIMAL(10, 2) NULL,
    `variance` DECIMAL(10, 2) NULL,
    `notes` VARCHAR(191) NULL,

    INDEX `StockOpnameRoll_opnameId_idx`(`opnameId`),
    INDEX `StockOpnameRoll_fabricRollId_idx`(`fabricRollId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ReconciliationRun` (
    `id` VARCHAR(191) NOT NULL,
    `triggeredBy` ENUM('CRON', 'MANUAL') NOT NULL,
    `status` ENUM('RUNNING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'RUNNING',
    `totalScanned` INTEGER NOT NULL DEFAULT 0,
    `inSync` INTEGER NOT NULL DEFAULT 0,
    `autoCorrected` INTEGER NOT NULL DEFAULT 0,
    `flagged` INTEGER NOT NULL DEFAULT 0,
    `startedById` VARCHAR(191) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,
    `errorMessage` TEXT NULL,

    INDEX `ReconciliationRun_status_idx`(`status`),
    INDEX `ReconciliationRun_startedAt_idx`(`startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ReconciliationResult` (
    `id` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `variantSku` VARCHAR(191) NULL,
    `itemName` VARCHAR(191) NOT NULL,
    `jubelioItemId` INTEGER NULL,
    `eloraeQty` DECIMAL(10, 2) NOT NULL,
    `jubelioQty` DECIMAL(10, 2) NOT NULL,
    `variance` DECIMAL(10, 2) NOT NULL,
    `action` ENUM('IN_SYNC', 'AUTO_CORRECTED', 'FLAGGED', 'MANUALLY_RESOLVED') NOT NULL,
    `resolvedAt` DATETIME(3) NULL,
    `resolvedById` VARCHAR(191) NULL,
    `resolutionDirection` ENUM('MATCH_JUBELIO', 'REASSERT_ELORAE') NULL,

    INDEX `ReconciliationResult_runId_idx`(`runId`),
    INDEX `ReconciliationResult_action_idx`(`action`),
    INDEX `ReconciliationResult_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
