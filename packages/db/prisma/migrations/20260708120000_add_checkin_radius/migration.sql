-- AlterTable
ALTER TABLE `Store` ADD COLUMN `checkinRadiusMeters` INTEGER NULL;

-- AlterTable
ALTER TABLE `StoreVisit`
    ADD COLUMN `checkinDistanceMeters` INTEGER NULL,
    ADD COLUMN `checkinOutOfRadius` BOOLEAN NOT NULL DEFAULT false;
