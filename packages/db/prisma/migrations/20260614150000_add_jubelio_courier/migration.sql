-- CreateTable
CREATE TABLE `JubelioCourier` (
    `id` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `syncedAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `JubelioCourier_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
