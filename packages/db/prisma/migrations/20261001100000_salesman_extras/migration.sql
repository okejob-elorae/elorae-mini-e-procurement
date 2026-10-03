-- Aplikasi salesman, lanjutan (2026-10-01). Pasangan MariaDB dari migrasi
-- Postgres `21_lengkap_lanjut` — lihat di sana untuk penjelasan tiap tabel.
ALTER TABLE `FieldSalesOrder` ADD COLUMN `cancelledById` VARCHAR(191) NULL,
    ADD COLUMN `cancelledAt` DATETIME(3) NULL,
    ADD COLUMN `replacesOrderId` VARCHAR(191) NULL;
CREATE INDEX `FieldSalesOrder_replacesOrderId_idx` ON `FieldSalesOrder`(`replacesOrderId`);

CREATE TABLE `VisitSchedule` (
    `id` VARCHAR(191) NOT NULL, `salesmanId` VARCHAR(191) NOT NULL, `storeId` VARCHAR(191) NOT NULL,
    `dayKey` VARCHAR(191) NOT NULL, `note` TEXT NULL, `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `VisitSchedule_salesmanId_storeId_dayKey_key`(`salesmanId`, `storeId`, `dayKey`),
    INDEX `VisitSchedule_dayKey_idx`(`dayKey`),
    INDEX `VisitSchedule_storeId_idx`(`storeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Announcement` (
    `id` VARCHAR(191) NOT NULL, `title` VARCHAR(191) NOT NULL, `body` TEXT NOT NULL,
    `audience` VARCHAR(191) NOT NULL DEFAULT 'SEMUA', `requireAck` BOOLEAN NOT NULL DEFAULT false,
    `pinned` BOOLEAN NOT NULL DEFAULT false, `publishedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL, `archivedAt` DATETIME(3) NULL, `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
    INDEX `Announcement_publishedAt_idx`(`publishedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AnnouncementRead` (
    `id` VARCHAR(191) NOT NULL, `announcementId` VARCHAR(191) NOT NULL, `userId` VARCHAR(191) NOT NULL,
    `readAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `ackAt` DATETIME(3) NULL,
    UNIQUE INDEX `AnnouncementRead_announcementId_userId_key`(`announcementId`, `userId`),
    INDEX `AnnouncementRead_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LeaveRequest` (
    `id` VARCHAR(191) NOT NULL, `userId` VARCHAR(191) NOT NULL, `type` VARCHAR(191) NOT NULL,
    `startDay` VARCHAR(191) NOT NULL, `endDay` VARCHAR(191) NOT NULL, `reason` TEXT NOT NULL,
    `photoUrl` VARCHAR(191) NULL, `status` VARCHAR(191) NOT NULL DEFAULT 'DIAJUKAN',
    `reviewedById` VARCHAR(191) NULL, `reviewedAt` DATETIME(3) NULL, `reviewNote` TEXT NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `LeaveRequest_idempotencyKey_key`(`idempotencyKey`),
    INDEX `LeaveRequest_userId_startDay_idx`(`userId`, `startDay`),
    INDEX `LeaveRequest_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SalesTarget` (
    `id` VARCHAR(191) NOT NULL, `salesmanId` VARCHAR(191) NOT NULL, `month` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(191) NOT NULL, `refId` VARCHAR(191) NOT NULL, `measure` VARCHAR(191) NOT NULL DEFAULT 'NILAI',
    `value` DECIMAL(15, 2) NOT NULL, `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `SalesTarget_salesmanId_month_scope_refId_key`(`salesmanId`, `month`, `scope`, `refId`),
    INDEX `SalesTarget_month_idx`(`month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `StoreNote` (
    `id` VARCHAR(191) NOT NULL, `storeId` VARCHAR(191) NOT NULL, `authorId` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL, `pinned` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    INDEX `StoreNote_storeId_deletedAt_idx`(`storeId`, `deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
