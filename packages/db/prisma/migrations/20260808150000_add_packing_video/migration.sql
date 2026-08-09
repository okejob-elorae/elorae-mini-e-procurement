-- CreateTable
CREATE TABLE `PackingVideo` (
    `id` VARCHAR(191) NOT NULL,
    `salesOrderId` VARCHAR(191) NOT NULL,
    `r2Key` VARCHAR(191) NOT NULL,
    `videoUrl` VARCHAR(191) NOT NULL,
    `contentType` VARCHAR(191) NOT NULL DEFAULT 'video/webm',
    `sizeBytes` INTEGER NULL,
    `durationSec` DECIMAL(10, 2) NULL,
    `recordedById` VARCHAR(191) NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedById` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `replacedAt` DATETIME(3) NULL,

    UNIQUE INDEX `PackingVideo_salesOrderId_key`(`salesOrderId`),
    INDEX `PackingVideo_recordedAt_idx`(`recordedAt`),
    INDEX `PackingVideo_recordedById_idx`(`recordedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PackingVideo` ADD CONSTRAINT `PackingVideo_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PackingVideo` ADD CONSTRAINT `PackingVideo_recordedById_fkey` FOREIGN KEY (`recordedById`) REFERENCES `User`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `PackingVideo` ADD CONSTRAINT `PackingVideo_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
