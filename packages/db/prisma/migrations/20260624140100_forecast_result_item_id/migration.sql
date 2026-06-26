-- ForecastResult item-centric grouping (Slice D')
ALTER TABLE `ForecastResult`
    ADD COLUMN `itemId` VARCHAR(191) NULL;

ALTER TABLE `ForecastResult`
    ADD CONSTRAINT `ForecastResult_itemId_fkey`
    FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE INDEX `ForecastResult_itemId_idx` ON `ForecastResult`(`itemId`);
