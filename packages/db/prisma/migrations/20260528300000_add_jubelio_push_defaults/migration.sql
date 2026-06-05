-- CreateTable
CREATE TABLE `JubelioPushDefaults` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'singleton',
    `sellTaxId` INTEGER NOT NULL DEFAULT -1,
    `buyTaxId` INTEGER NOT NULL DEFAULT -1,
    `salesAcctId` INTEGER NOT NULL DEFAULT 28,
    `cogsAcctId` INTEGER NOT NULL DEFAULT 30,
    `invtAcctId` INTEGER NOT NULL DEFAULT 4,
    `purchAcctId` INTEGER NULL,
    `uomId` INTEGER NOT NULL DEFAULT -1,
    `brandId` VARCHAR(191) NULL,
    `brandName` VARCHAR(191) NULL,
    `sellThis` BOOLEAN NOT NULL DEFAULT true,
    `buyThis` BOOLEAN NOT NULL DEFAULT true,
    `stockThis` BOOLEAN NOT NULL DEFAULT true,
    `dropshipThis` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sellUnit` VARCHAR(191) NOT NULL DEFAULT 'Buah',
    `buyUnit` VARCHAR(191) NOT NULL DEFAULT 'Buah',
    `packageWeight` INTEGER NOT NULL DEFAULT 1000,
    `storePriorityQtyTreshold` INTEGER NOT NULL DEFAULT 0,
    `rop` INTEGER NOT NULL DEFAULT 0,
    `useSingleImageSet` BOOLEAN NOT NULL DEFAULT false,
    `useSerialNumber` BOOLEAN NOT NULL DEFAULT false,
    `buyPrice` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedById` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed singleton
INSERT INTO `JubelioPushDefaults` (`id`, `updatedAt`) VALUES ('singleton', CURRENT_TIMESTAMP(3));
