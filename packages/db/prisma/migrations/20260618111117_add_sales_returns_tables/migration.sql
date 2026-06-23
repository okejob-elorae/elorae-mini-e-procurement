CREATE TABLE `SalesReturn` (
  `id` VARCHAR(191) NOT NULL,
  `jubelioReturnId` INT NOT NULL,
  `jubelioReturnNo` VARCHAR(191) NULL,
  `salesOrderId` VARCHAR(191) NULL,
  `channel` ENUM('SHOPEE','TIKTOK','TOKOPEDIA','OTHER') NOT NULL,
  `channelOrderNo` VARCHAR(191) NULL,
  `status` ENUM('PENDING','ACCEPTED','REJECTED','PARTIAL') NOT NULL DEFAULT 'PENDING',
  `buyerName` VARCHAR(191) NULL,
  `totalQty` DECIMAL(10,2) NOT NULL,
  `totalValue` DECIMAL(15,2) NOT NULL DEFAULT 0,
  `receivedAt` DATETIME(3) NOT NULL,
  `decidedAt` DATETIME(3) NULL,
  `decidedById` VARCHAR(191) NULL,
  `pushOutboxRowId` VARCHAR(191) NULL,
  `rawIngestPayload` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `SalesReturn_jubelioReturnId_key` (`jubelioReturnId`),
  UNIQUE INDEX `SalesReturn_jubelioReturnNo_key` (`jubelioReturnNo`),
  INDEX `SalesReturn_status_receivedAt_idx` (`status`, `receivedAt`),
  INDEX `SalesReturn_channel_status_idx` (`channel`, `status`),
  INDEX `SalesReturn_salesOrderId_idx` (`salesOrderId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SalesReturnItem` (
  `id` VARCHAR(191) NOT NULL,
  `salesReturnId` VARCHAR(191) NOT NULL,
  `jubelioReturnDetailId` INT NULL,
  `jubelioItemId` INT NULL,
  `salesOrderDetailId` INT NULL,
  `itemId` VARCHAR(191) NULL,
  `variantSku` VARCHAR(191) NULL,
  `externalSku` VARCHAR(191) NOT NULL,
  `productName` VARCHAR(191) NOT NULL,
  `qty` DECIMAL(10,2) NOT NULL,
  `unitPrice` DECIMAL(15,2) NOT NULL,
  `subtotal` DECIMAL(15,2) NOT NULL,
  `itemReason` TEXT NULL,
  `decision` ENUM('PENDING','ACCEPTED','REJECTED') NOT NULL DEFAULT 'PENDING',
  `decidedAt` DATETIME(3) NULL,
  `decidedById` VARCHAR(191) NULL,
  `stockAdjustmentId` VARCHAR(191) NULL,
  `evidenceUrls` JSON NULL,
  `r2Keys` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `SalesReturnItem_jubelioReturnDetailId_key` (`jubelioReturnDetailId`),
  UNIQUE INDEX `SalesReturnItem_stockAdjustmentId_key` (`stockAdjustmentId`),
  INDEX `SalesReturnItem_salesReturnId_idx` (`salesReturnId`),
  INDEX `SalesReturnItem_itemId_idx` (`itemId`),
  INDEX `SalesReturnItem_decision_idx` (`decision`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SalesReturn`
  ADD CONSTRAINT `SalesReturn_salesOrderId_fkey`
  FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `SalesReturn`
  ADD CONSTRAINT `SalesReturn_decidedById_fkey`
  FOREIGN KEY (`decidedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `SalesReturnItem`
  ADD CONSTRAINT `SalesReturnItem_salesReturnId_fkey`
  FOREIGN KEY (`salesReturnId`) REFERENCES `SalesReturn`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `SalesReturnItem`
  ADD CONSTRAINT `SalesReturnItem_itemId_fkey`
  FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `SalesReturnItem`
  ADD CONSTRAINT `SalesReturnItem_decidedById_fkey`
  FOREIGN KEY (`decidedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `SalesReturnItem`
  ADD CONSTRAINT `SalesReturnItem_stockAdjustmentId_fkey`
  FOREIGN KEY (`stockAdjustmentId`) REFERENCES `StockAdjustment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
