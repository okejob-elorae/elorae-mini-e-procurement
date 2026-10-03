-- Salesman field work, stage 2. Rationale: packages/db/prisma/postgres/migrations/17_lapangan.
-- CollectionNote / PaymentClaim belong to the receivables module, which has no
-- MariaDB migrations yet (see CLAUDE.md "Migrasi hanya ada di sisi PostgreSQL"),
-- so their new columns are NOT here — they ship with that module's MariaDB port.
ALTER TABLE `StoreVisit` ADD COLUMN `checkinAccuracyMeters` INTEGER NULL,
    ADD COLUMN `checkinFlags` JSON NULL,
    ADD COLUMN `outcome` VARCHAR(191) NULL,
    ADD COLUMN `outcomeNote` TEXT NULL;

ALTER TABLE `FieldSalesOrder` ADD COLUMN `remoteChannel` VARCHAR(191) NULL;

CREATE TABLE `StoreProposal` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `address` TEXT NOT NULL,
    `phone` VARCHAR(191) NULL,
    `contactName` VARCHAR(191) NULL,
    `termsType` ENUM('PUTUS', 'KONSI') NULL,
    `groupId` VARCHAR(191) NULL,
    `lat` DECIMAL(10, 7) NULL,
    `lng` DECIMAL(10, 7) NULL,
    `photoUrl` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `proposedById` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` TEXT NULL,
    `storeId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StoreProposal_idempotencyKey_key`(`idempotencyKey`),
    INDEX `StoreProposal_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `StoreProposal_proposedById_idx`(`proposedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
