-- Item: target margin and additional cost
ALTER TABLE `Item`
  ADD COLUMN `targetMarginPercent` DECIMAL(5,2) NULL,
  ADD COLUMN `additionalCost` DECIMAL(15,2) NULL;

-- JubelioPushDefaults: default margin and additional cost
ALTER TABLE `JubelioPushDefaults`
  ADD COLUMN `defaultMarginPercent` DECIMAL(5,2) NULL,
  ADD COLUMN `defaultAdditionalCost` DECIMAL(15,2) NULL;

-- CreateTable
CREATE TABLE `ItemPriceChangeLog` (
  `id` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `oldSellingPrice` DECIMAL(14,2) NULL,
  `newSellingPrice` DECIMAL(14,2) NULL,
  `oldAvgCost` DECIMAL(15,2) NULL,
  `newAvgCost` DECIMAL(15,2) NULL,
  `marginPercentUsed` DECIMAL(5,2) NULL,
  `additionalCostUsed` DECIMAL(15,2) NULL,
  `triggerReason` ENUM('FG_RECEIPT','MARGIN_CHANGE','DEFAULTS_CHANGE','MANUAL_EDIT') NOT NULL,
  `fgReceiptId` VARCHAR(191) NULL,
  `changedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `changedById` VARCHAR(191) NULL,

  INDEX `ItemPriceChangeLog_itemId_changedAt_idx`(`itemId`, `changedAt`),
  INDEX `ItemPriceChangeLog_fgReceiptId_idx`(`fgReceiptId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ItemPriceChangeLog` ADD CONSTRAINT `ItemPriceChangeLog_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ItemPriceChangeLog` ADD CONSTRAINT `ItemPriceChangeLog_fgReceiptId_fkey` FOREIGN KEY (`fgReceiptId`) REFERENCES `FGReceipt`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ItemPriceChangeLog` ADD CONSTRAINT `ItemPriceChangeLog_changedById_fkey` FOREIGN KEY (`changedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
