-- CreateTable
CREATE TABLE `SupplierType` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SupplierType_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed default supplier types (fixed ids for backfill)
INSERT INTO `SupplierType` (`id`, `code`, `name`, `isActive`, `sortOrder`, `createdAt`, `updatedAt`) VALUES
('st-fabric', 'FABRIC', 'Fabric', true, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
('st-accessories', 'ACCESSORIES', 'Accessories', true, 2, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
('st-tailor', 'TAILOR', 'Tailor/Production', true, 3, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
('st-other', 'OTHER', 'Other', true, 4, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

-- Add typeId to Supplier (nullable first for backfill)
ALTER TABLE `Supplier` ADD COLUMN `typeId` VARCHAR(191) NULL;

-- Backfill typeId from enum type (join on code)
UPDATE `Supplier` s
INNER JOIN `SupplierType` st ON st.`code` = s.`type`
SET s.`typeId` = st.`id`;

-- Drop old type column and index (TiDB 8200: avoid multiple ops on same column in one ALTER)
ALTER TABLE `Supplier` DROP INDEX `Supplier_type_idx`;
ALTER TABLE `Supplier` DROP COLUMN `type`;
ALTER TABLE `Supplier` MODIFY COLUMN `typeId` VARCHAR(191) NOT NULL;
ALTER TABLE `Supplier` ADD INDEX `Supplier_typeId_idx`(`typeId`);
