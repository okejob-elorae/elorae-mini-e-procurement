-- CreateEnum (MySQL: ItemTypeGroup is used as column type)
-- CreateTable
CREATE TABLE `ItemTypeMaster` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `nameId` VARCHAR(191) NOT NULL,
    `nameEn` VARCHAR(191) NOT NULL,
    `group` ENUM('RAW', 'FINISHED') NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ItemTypeMaster_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed: map current ItemType enum to display + group (stable ids for reference)
INSERT INTO `ItemTypeMaster` (`id`, `code`, `nameId`, `nameEn`, `group`, `sortOrder`, `createdAt`, `updatedAt`) VALUES
('itemtype_fabric_001', 'FABRIC', 'Kain / Fabric', 'Fabric', 'RAW', 1, NOW(3), NOW(3)),
('itemtype_accessories_002', 'ACCESSORIES', 'Aksesoris', 'Accessories', 'RAW', 2, NOW(3), NOW(3)),
('itemtype_fg_003', 'FINISHED_GOOD', 'Barang Jadi', 'Finished Good', 'FINISHED', 3, NOW(3), NOW(3));
