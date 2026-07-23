-- CreateTable
CREATE TABLE `JournalAccountMapping` (
    `id` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `chartAccountId` VARCHAR(191) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `JournalAccountMapping_role_key`(`role`),
    INDEX `JournalAccountMapping_chartAccountId_idx`(`chartAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `JournalAccountMapping` ADD CONSTRAINT `JournalAccountMapping_chartAccountId_fkey` FOREIGN KEY (`chartAccountId`) REFERENCES `ChartAccount`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
