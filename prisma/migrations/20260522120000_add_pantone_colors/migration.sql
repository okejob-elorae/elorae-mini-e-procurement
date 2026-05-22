-- CreateTable
CREATE TABLE `PantoneColor` (
    `tcx` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `hex` VARCHAR(191) NOT NULL,
    `rgbR` INTEGER NOT NULL,
    `rgbG` INTEGER NOT NULL,
    `rgbB` INTEGER NOT NULL,
    `groupName` VARCHAR(191) NULL,
    `filterTags` JSON NOT NULL,
    `labL` DOUBLE NULL,
    `labA` DOUBLE NULL,
    `labB` DOUBLE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PantoneColor_name_idx`(`name`),
    INDEX `PantoneColor_groupName_idx`(`groupName`),
    PRIMARY KEY (`tcx`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PantoneColorFavorite` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tcx` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PantoneColorFavorite_userId_idx`(`userId`),
    INDEX `PantoneColorFavorite_tcx_idx`(`tcx`),
    UNIQUE INDEX `PantoneColorFavorite_userId_tcx_key`(`userId`, `tcx`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
