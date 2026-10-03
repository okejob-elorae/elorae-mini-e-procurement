-- People & supervision, stage 4. Rationale: packages/db/prisma/postgres/migrations/19_orang.
CREATE TABLE `ExpenseClaim` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `spentAt` DATETIME(3) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `photoUrl` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `visitId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DIAJUKAN',
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` TEXT NULL,
    `paidById` VARCHAR(191) NULL,
    `paidAt` DATETIME(3) NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ExpenseClaim_idempotencyKey_key`(`idempotencyKey`),
    INDEX `ExpenseClaim_userId_spentAt_idx`(`userId`, `spentAt`),
    INDEX `ExpenseClaim_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Attendance` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `dayKey` VARCHAR(191) NOT NULL,
    `clockInAt` DATETIME(3) NOT NULL,
    `clockInLat` DECIMAL(10, 7) NULL,
    `clockInLng` DECIMAL(10, 7) NULL,
    `clockInAccuracy` INTEGER NULL,
    `selfieUrl` VARCHAR(191) NULL,
    `clockOutAt` DATETIME(3) NULL,
    `clockOutLat` DECIMAL(10, 7) NULL,
    `clockOutLng` DECIMAL(10, 7) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Attendance_userId_dayKey_key`(`userId`, `dayKey`),
    INDEX `Attendance_dayKey_idx`(`dayKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
