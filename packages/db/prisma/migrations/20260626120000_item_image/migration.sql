CREATE TABLE `ItemImage` (
  `id` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `variantSku` VARCHAR(191) NULL,
  `url` VARCHAR(500) NOT NULL,
  `sortOrder` INT NOT NULL DEFAULT 0,
  `jubelioImageId` VARCHAR(191) NULL,
  `syncedAt` DATETIME(3) NULL,
  `source` VARCHAR(191) NOT NULL DEFAULT 'ERP_UPLOAD',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `ItemImage_jubelioImageId_key` (`jubelioImageId`),
  INDEX `ItemImage_itemId_variantSku_sortOrder_idx` (`itemId`, `variantSku`, `sortOrder`),
  INDEX `ItemImage_itemId_jubelioImageId_idx` (`itemId`, `jubelioImageId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ItemImage` ADD CONSTRAINT `ItemImage_itemId_fkey`
  FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
