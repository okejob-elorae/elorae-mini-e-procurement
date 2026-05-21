-- AlterTable: add rollCode to FabricRoll (formal roll code for traceability)
ALTER TABLE `FabricRoll` ADD COLUMN `rollCode` VARCHAR(191) NULL;

-- Backfill existing rows with a unique value
UPDATE `FabricRoll` SET `rollCode` = CONCAT('LEGACY-', `id`) WHERE `rollCode` IS NULL;

-- Make rollCode required and unique
ALTER TABLE `FabricRoll` MODIFY COLUMN `rollCode` VARCHAR(191) NOT NULL;
CREATE UNIQUE INDEX `FabricRoll_rollCode_key` ON `FabricRoll`(`rollCode`);
CREATE INDEX `FabricRoll_rollCode_idx` ON `FabricRoll`(`rollCode`);

-- CreateTable: system key-value settings (e.g. PPN rate)
CREATE TABLE `SystemSetting` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `SystemSetting_key_key` ON `SystemSetting`(`key`);
