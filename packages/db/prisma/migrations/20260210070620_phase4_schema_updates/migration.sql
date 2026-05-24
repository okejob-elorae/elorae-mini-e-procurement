/*
  Warnings:

  - Added the required column `createdById` to the `VendorReturn` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalValue` to the `VendorReturn` table without a default value. This is not possible if the table is not empty.
  - Added the required column `finishedGoodId` to the `WorkOrder` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `FGReceipt` ADD COLUMN `materialCost` DECIMAL(15, 2) NULL,
    ADD COLUMN `qcPassed` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `MaterialIssue` ADD COLUMN `notes` TEXT NULL,
    ADD COLUMN `splitSequence` INTEGER NULL;

-- AlterTable
ALTER TABLE `VendorReturn` ADD COLUMN `createdById` VARCHAR(191) NOT NULL,
    ADD COLUMN `totalValue` DECIMAL(15, 2) NOT NULL;

-- AlterTable
ALTER TABLE `WorkOrder` ADD COLUMN `finishedGoodId` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE INDEX `FGReceipt_docNumber_idx` ON `FGReceipt`(`docNumber`);

-- CreateIndex
CREATE INDEX `MaterialIssue_docNumber_idx` ON `MaterialIssue`(`docNumber`);

-- CreateIndex
CREATE INDEX `VendorReturn_createdById_idx` ON `VendorReturn`(`createdById`);

-- CreateIndex
CREATE INDEX `WorkOrder_finishedGoodId_idx` ON `WorkOrder`(`finishedGoodId`);
