-- AlterTable
ALTER TABLE `Item` ADD COLUMN `categoryId` VARCHAR(191) NULL,
    ADD COLUMN `overReceiveThreshold` DECIMAL(10,2) NULL;

-- AlterTable
ALTER TABLE `POItem` ADD COLUMN `ppnIncluded` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `GRN` ADD COLUMN `requiresOwnerApproval` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `ownerApprovedAt` DATETIME(3) NULL,
    ADD COLUMN `ownerApprovedById` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `StockMovement` ADD COLUMN `variantSku` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `WorkOrder` ADD COLUMN `hppMarginPercent` DECIMAL(5,2) NULL,
    ADD COLUMN `hppAdditionalCost` DECIMAL(15,2) NULL;

-- AlterTable
ALTER TABLE `VendorReturn` ADD COLUMN `grnId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `ItemCategory` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `ItemCategory_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FabricRoll` (
    `id` VARCHAR(191) NOT NULL,
    `grnId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `rollRef` VARCHAR(191) NOT NULL,
    `initialLength` DECIMAL(10,2) NOT NULL,
    `remainingLength` DECIMAL(10,2) NOT NULL,
    `uomId` VARCHAR(191) NOT NULL,
    `isClosed` BOOLEAN NOT NULL DEFAULT false,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WorkOrderStep` (
    `id` VARCHAR(191) NOT NULL,
    `woId` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `stepName` VARCHAR(191) NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `servicePrice` DECIMAL(15,2) NOT NULL DEFAULT 0,
    `qty` DECIMAL(10,2) NULL,
    `totalCost` DECIMAL(15,2) NULL,
    `issueDocNumber` VARCHAR(191) NULL,
    `receiptDocNumber` VARCHAR(191) NULL,
    `issuedAt` DATETIME(3) NULL,
    `receivedAt` DATETIME(3) NULL,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Item_categoryId_idx` ON `Item`(`categoryId`);
CREATE INDEX `GRN_ownerApprovedById_idx` ON `GRN`(`ownerApprovedById`);
CREATE INDEX `VendorReturn_grnId_idx` ON `VendorReturn`(`grnId`);
CREATE INDEX `FabricRoll_grnId_idx` ON `FabricRoll`(`grnId`);
CREATE INDEX `FabricRoll_itemId_idx` ON `FabricRoll`(`itemId`);
CREATE INDEX `FabricRoll_uomId_idx` ON `FabricRoll`(`uomId`);
CREATE INDEX `WorkOrderStep_woId_idx` ON `WorkOrderStep`(`woId`);
CREATE INDEX `WorkOrderStep_supplierId_idx` ON `WorkOrderStep`(`supplierId`);
CREATE UNIQUE INDEX `WorkOrderStep_woId_sequence_key` ON `WorkOrderStep`(`woId`, `sequence`);

-- AddForeignKey
ALTER TABLE `Item` ADD CONSTRAINT `Item_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `ItemCategory`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE `GRN` ADD CONSTRAINT `GRN_ownerApprovedById_fkey` FOREIGN KEY (`ownerApprovedById`) REFERENCES `User`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE `VendorReturn` ADD CONSTRAINT `VendorReturn_grnId_fkey` FOREIGN KEY (`grnId`) REFERENCES `GRN`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE `FabricRoll` ADD CONSTRAINT `FabricRoll_grnId_fkey` FOREIGN KEY (`grnId`) REFERENCES `GRN`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE `FabricRoll` ADD CONSTRAINT `FabricRoll_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE `FabricRoll` ADD CONSTRAINT `FabricRoll_uomId_fkey` FOREIGN KEY (`uomId`) REFERENCES `UOM`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE `WorkOrderStep` ADD CONSTRAINT `WorkOrderStep_woId_fkey` FOREIGN KEY (`woId`) REFERENCES `WorkOrder`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE `WorkOrderStep` ADD CONSTRAINT `WorkOrderStep_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
