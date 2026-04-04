ALTER TABLE `GRN` ADD COLUMN `ownerDeclinedAt` DATETIME(3) NULL,
    ADD COLUMN `ownerDeclinedById` VARCHAR(191) NULL;

CREATE INDEX `GRN_ownerDeclinedById_idx` ON `GRN`(`ownerDeclinedById`);
