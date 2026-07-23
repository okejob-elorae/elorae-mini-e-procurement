-- CreateTable
CREATE TABLE `Journal` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `sourceType` VARCHAR(191) NULL,
    `sourceId` VARCHAR(191) NULL,
    `isManual` BOOLEAN NOT NULL DEFAULT false,
    `postedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Journal_date_idx`(`date`),
    INDEX `Journal_sourceType_sourceId_idx`(`sourceType`, `sourceId`),
    UNIQUE INDEX `Journal_sourceType_sourceId_key`(`sourceType`, `sourceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JournalLine` (
    `id` VARCHAR(191) NOT NULL,
    `journalId` VARCHAR(191) NOT NULL,
    `chartAccountId` VARCHAR(191) NOT NULL,
    `debit` DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    `credit` DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    `memo` VARCHAR(191) NULL,

    INDEX `JournalLine_journalId_idx`(`journalId`),
    INDEX `JournalLine_chartAccountId_idx`(`chartAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `JournalLine` ADD CONSTRAINT `JournalLine_journalId_fkey` FOREIGN KEY (`journalId`) REFERENCES `Journal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JournalLine` ADD CONSTRAINT `JournalLine_chartAccountId_fkey` FOREIGN KEY (`chartAccountId`) REFERENCES `ChartAccount`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
