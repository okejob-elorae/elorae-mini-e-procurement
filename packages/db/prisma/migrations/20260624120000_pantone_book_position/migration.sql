-- AlterTable
ALTER TABLE `PantoneColor` ADD COLUMN `bookSection` INTEGER NULL,
    ADD COLUMN `bookPage` INTEGER NULL,
    ADD COLUMN `bookColumn` INTEGER NULL,
    ADD COLUMN `bookRow` INTEGER NULL;

-- CreateIndex
CREATE INDEX `PantoneColor_bookSection_bookPage_idx` ON `PantoneColor`(`bookSection`, `bookPage`);
