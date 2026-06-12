-- DropIndex
DROP INDEX `JubelioCategoryMapping_itemCategoryId_idx` ON `JubelioCategoryMapping`;

-- CreateIndex
CREATE UNIQUE INDEX `JubelioCategoryMapping_itemCategoryId_key` ON `JubelioCategoryMapping`(`itemCategoryId`);
