-- AlterTable
ALTER TABLE `vendorreturn` ADD COLUMN `completedAt` DATETIME(3) NULL,
    ADD COLUMN `completedById` VARCHAR(191) NULL,
    ADD COLUMN `receiptFileUrl` VARCHAR(191) NULL,
    ADD COLUMN `trackingNumber` VARCHAR(191) NULL,
    MODIFY `status` ENUM('DRAFT', 'SUBMITTED', 'PROCESSED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT';

-- CreateIndex
CREATE INDEX `VendorReturn_completedById_idx` ON `VendorReturn`(`completedById`);
