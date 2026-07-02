-- CreateTable
CREATE TABLE `Store` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `address` TEXT NOT NULL,
    `phone` VARCHAR(191) NULL,
    `contactName` VARCHAR(191) NULL,
    `termsType` ENUM('PUTUS', 'KONSI') NOT NULL,
    `paymentTempo` INTEGER NOT NULL DEFAULT 0,
    `marginPercent` DECIMAL(5, 2) NULL,
    `lat` DECIMAL(10, 7) NULL,
    `lng` DECIMAL(10, 7) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Store_code_key`(`code`),
    INDEX `Store_isActive_name_idx`(`isActive`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoreVisit` (
    `id` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `checkinAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `checkoutAt` DATETIME(3) NULL,
    `checkinLat` DECIMAL(10, 7) NOT NULL,
    `checkinLng` DECIMAL(10, 7) NOT NULL,
    `checkoutLat` DECIMAL(10, 7) NULL,
    `checkoutLng` DECIMAL(10, 7) NULL,
    `autoClosed` BOOLEAN NOT NULL DEFAULT false,

    INDEX `StoreVisit_userId_checkoutAt_idx`(`userId`, `checkoutAt`),
    INDEX `StoreVisit_storeId_checkinAt_idx`(`storeId`, `checkinAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
