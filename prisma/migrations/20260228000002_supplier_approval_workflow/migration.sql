-- AlterTable
ALTER TABLE `Supplier` ADD COLUMN `status` ENUM('PENDING_APPROVAL', 'ACTIVE', 'REJECTED') NOT NULL DEFAULT 'PENDING_APPROVAL',
ADD COLUMN `approvedById` VARCHAR(191) NULL,
ADD COLUMN `approvedAt` DATETIME(3) NULL,
ADD COLUMN `rejectionReason` TEXT NULL;

-- Set existing suppliers to ACTIVE (they were created before approval workflow)
UPDATE `Supplier` SET `status` = 'ACTIVE';

-- CreateIndex
CREATE INDEX `Supplier_status_idx` ON `Supplier`(`status`);
CREATE INDEX `Supplier_approvedById_idx` ON `Supplier`(`approvedById`);

-- AddForeignKey
ALTER TABLE `Supplier` ADD CONSTRAINT `Supplier_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `User`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
