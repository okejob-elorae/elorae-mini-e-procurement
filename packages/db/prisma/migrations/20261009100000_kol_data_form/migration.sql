-- Formulir data KOL lewat link (2026-10-09).
-- Rancangan: docs/superpowers/specs/2026-10-09-formulir-data-kol-design.md
-- Kembaran MariaDB dari Postgres 43_formulir_kol. Tanpa foreign key (relationMode = prisma).

CREATE TABLE `KolFormLink` (
    `id` VARCHAR(191) NOT NULL,
    `kolId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `KolFormLink_tokenHash_key`(`tokenHash`),
    INDEX `KolFormLink_kolId_idx`(`kolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `KolFormSubmission` (
    `id` VARCHAR(191) NOT NULL,
    `linkId` VARCHAR(191) NOT NULL,
    `kolId` VARCHAR(191) NOT NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `changes` TEXT NOT NULL,
    `replacedCount` INTEGER NOT NULL DEFAULT 0,
    `reviewedAt` DATETIME(3) NULL,
    `reviewedById` VARCHAR(191) NULL,

    INDEX `KolFormSubmission_kolId_idx`(`kolId`),
    INDEX `KolFormSubmission_reviewedAt_idx`(`reviewedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
