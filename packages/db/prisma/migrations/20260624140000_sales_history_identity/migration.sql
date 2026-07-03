-- SalesHistory product identity fields (Slice A)
ALTER TABLE `SalesHistory`
    ADD COLUMN `itemId` VARCHAR(191) NULL,
    ADD COLUMN `erpVariantSku` VARCHAR(191) NULL,
    ADD COLUMN `jubelioItemId` INTEGER NULL,
    ADD COLUMN `resolutionStatus` ENUM('MAPPED', 'UNMAPPED', 'AMBIGUOUS') NOT NULL DEFAULT 'UNMAPPED';

ALTER TABLE `SalesHistory`
    ADD CONSTRAINT `SalesHistory_itemId_fkey`
    FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE INDEX `SalesHistory_itemId_idx` ON `SalesHistory`(`itemId`);
CREATE INDEX `SalesHistory_resolutionStatus_idx` ON `SalesHistory`(`resolutionStatus`);
