-- Link Plan Kerja parent rows to Item Category master (MySQL / TiDB)
ALTER TABLE `PlanCategory` ADD COLUMN `itemCategoryId` VARCHAR(191) NULL;

UPDATE `PlanCategory` pc
INNER JOIN `ItemCategory` ic ON ic.`code` IS NOT NULL AND TRIM(ic.`code`) = TRIM(pc.`code`)
SET pc.`itemCategoryId` = ic.`id`, pc.`name` = ic.`name`
WHERE pc.`parentId` IS NULL;

CREATE INDEX `PlanCategory_itemCategoryId_idx` ON `PlanCategory`(`itemCategoryId`);

CREATE UNIQUE INDEX `PlanCategory_planYearId_itemCategoryId_key` ON `PlanCategory`(`planYearId`, `itemCategoryId`);

ALTER TABLE `PlanCategory` ADD CONSTRAINT `PlanCategory_itemCategoryId_fkey` FOREIGN KEY (`itemCategoryId`) REFERENCES `ItemCategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
