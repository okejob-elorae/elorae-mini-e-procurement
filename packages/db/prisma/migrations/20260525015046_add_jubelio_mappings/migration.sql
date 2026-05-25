-- CreateTable
CREATE TABLE `JubelioProductMapping` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `jubelioItemGroupId` INTEGER NOT NULL,
    `jubelioItemId` INTEGER NOT NULL,
    `jubelioItemCode` VARCHAR(191) NOT NULL,
    `erpVariantSku` VARCHAR(191) NOT NULL,
    `lastSyncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `jubelioLastModified` DATETIME(3) NULL,

    UNIQUE INDEX `JubelioProductMapping_jubelioItemId_key`(`jubelioItemId`),
    INDEX `JubelioProductMapping_itemId_idx`(`itemId`),
    INDEX `JubelioProductMapping_jubelioItemGroupId_idx`(`jubelioItemGroupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JubelioCategoryMapping` (
    `id` VARCHAR(191) NOT NULL,
    `jubelioCategoryId` INTEGER NOT NULL,
    `itemCategoryId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `JubelioCategoryMapping_jubelioCategoryId_key`(`jubelioCategoryId`),
    INDEX `JubelioCategoryMapping_itemCategoryId_idx`(`itemCategoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
