-- CreateTable
CREATE TABLE `JubelioApiCall` (
    `id` VARCHAR(191) NOT NULL,
    `method` VARCHAR(191) NOT NULL,
    `path` VARCHAR(191) NOT NULL,
    `payloadHash` VARCHAR(191) NULL,
    `statusCode` INTEGER NULL,
    `latencyMs` INTEGER NOT NULL,
    `ok` BOOLEAN NOT NULL,
    `rateLimited` BOOLEAN NOT NULL DEFAULT false,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `JubelioApiCall_createdAt_idx`(`createdAt`),
    INDEX `JubelioApiCall_path_createdAt_idx`(`path`, `createdAt`),
    INDEX `JubelioApiCall_ok_createdAt_idx`(`ok`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
