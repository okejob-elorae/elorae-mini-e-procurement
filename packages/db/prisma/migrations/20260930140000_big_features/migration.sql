-- Big salesman features, stage 5. Rationale: packages/db/prisma/postgres/migrations/20_besar.
ALTER TABLE `FieldSalesOrder` ADD COLUMN `preorderWindowId` VARCHAR(191) NULL,
    ADD INDEX `FieldSalesOrder_preorderWindowId_idx`(`preorderWindowId`);
ALTER TABLE `FieldSalesDelivery` ADD COLUMN `receivedByName` VARCHAR(191) NULL,
    ADD COLUMN `receivedAt` DATETIME(3) NULL,
    ADD COLUMN `podPhotoUrl` VARCHAR(191) NULL;
ALTER TABLE `VisitPhoto` ADD COLUMN `displayGuideId` VARCHAR(191) NULL;

CREATE TABLE `PreorderWindow` (
    `id` VARCHAR(191) NOT NULL, `name` VARCHAR(191) NOT NULL, `note` TEXT NULL,
    `opensAt` DATETIME(3) NOT NULL, `closesAt` DATETIME(3) NOT NULL,
    `shipFrom` DATETIME(3) NULL, `shipTo` DATETIME(3) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true, `releasedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
    INDEX `PreorderWindow_isActive_closesAt_idx`(`isActive`, `closesAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PreorderWindowItem` (
    `id` VARCHAR(191) NOT NULL, `windowId` VARCHAR(191) NOT NULL, `itemId` VARCHAR(191) NOT NULL, `plannedQty` INTEGER NULL,
    UNIQUE INDEX `PreorderWindowItem_windowId_itemId_key`(`windowId`, `itemId`),
    INDEX `PreorderWindowItem_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `VisitChecklistTemplate` (
    `id` VARCHAR(191) NOT NULL, `name` VARCHAR(191) NOT NULL, `termsType` ENUM('PUTUS', 'KONSI') NULL,
    `questions` JSON NOT NULL, `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `VisitChecklistResult` (
    `id` VARCHAR(191) NOT NULL, `visitId` VARCHAR(191) NOT NULL, `templateId` VARCHAR(191) NOT NULL,
    `answers` JSON NOT NULL, `score` INTEGER NOT NULL, `maxScore` INTEGER NOT NULL, `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `VisitChecklistResult_visitId_templateId_key`(`visitId`, `templateId`),
    INDEX `VisitChecklistResult_templateId_idx`(`templateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CompetitorPrice` (
    `id` VARCHAR(191) NOT NULL, `storeId` VARCHAR(191) NOT NULL, `visitId` VARCHAR(191) NULL,
    `brand` VARCHAR(191) NOT NULL, `productName` VARCHAR(191) NOT NULL, `category` VARCHAR(191) NULL,
    `price` DECIMAL(15, 2) NOT NULL, `photoUrl` VARCHAR(191) NULL, `note` TEXT NULL, `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `CompetitorPrice_storeId_createdAt_idx`(`storeId`, `createdAt`),
    INDEX `CompetitorPrice_brand_idx`(`brand`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DisplayGuide` (
    `id` VARCHAR(191) NOT NULL, `title` VARCHAR(191) NOT NULL, `body` TEXT NOT NULL, `imageUrl` VARCHAR(191) NULL,
    `termsType` ENUM('PUTUS', 'KONSI') NULL, `groupId` VARCHAR(191) NULL,
    `activeFrom` DATETIME(3) NULL, `activeTo` DATETIME(3) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true, `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CollectionTask` (
    `id` VARCHAR(191) NOT NULL, `assigneeId` VARCHAR(191) NOT NULL, `storeId` VARCHAR(191) NOT NULL,
    `receivableIds` JSON NOT NULL, `note` TEXT NULL, `dueDate` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'TERBUKA', `createdById` VARCHAR(191) NOT NULL, `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
    INDEX `CollectionTask_assigneeId_status_idx`(`assigneeId`, `status`),
    INDEX `CollectionTask_storeId_idx`(`storeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `StoreExchange` (
    `id` VARCHAR(191) NOT NULL, `docNo` VARCHAR(191) NOT NULL, `storeId` VARCHAR(191) NOT NULL,
    `salesmanId` VARCHAR(191) NOT NULL, `visitId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DIAJUKAN', `note` TEXT NULL,
    `reviewedById` VARCHAR(191) NULL, `reviewedAt` DATETIME(3) NULL, `reviewNote` TEXT NULL, `completedAt` DATETIME(3) NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `StoreExchange_docNo_key`(`docNo`),
    UNIQUE INDEX `StoreExchange_idempotencyKey_key`(`idempotencyKey`),
    INDEX `StoreExchange_storeId_createdAt_idx`(`storeId`, `createdAt`),
    INDEX `StoreExchange_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `StoreExchangeLine` (
    `id` VARCHAR(191) NOT NULL, `exchangeId` VARCHAR(191) NOT NULL, `direction` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL, `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
    `productName` VARCHAR(191) NOT NULL, `qty` INTEGER NOT NULL,
    INDEX `StoreExchangeLine_exchangeId_idx`(`exchangeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `StorePortalLink` (
    `id` VARCHAR(191) NOT NULL, `storeId` VARCHAR(191) NOT NULL, `tokenHash` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NULL, `createdById` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NULL, `revokedAt` DATETIME(3) NULL, `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `StorePortalLink_tokenHash_key`(`tokenHash`),
    INDEX `StorePortalLink_storeId_idx`(`storeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
