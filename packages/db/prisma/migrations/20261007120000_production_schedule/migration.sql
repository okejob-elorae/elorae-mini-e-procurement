-- Jadwal produksi per tahap Plan Kerja (MariaDB). Setara 36_jadwal_produksi
-- di sisi Postgres; alasannya ditulis di sana.
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.

-- AlterTable
ALTER TABLE `PurchaseOrder` ADD COLUMN `planStageId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `PlanStage` ADD COLUMN `deadline` DATETIME(3) NULL,
    ADD COLUMN `scheduleStart` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `PlanStageStep` (
    `id` VARCHAR(191) NOT NULL,
    `planStageId` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `processTemplateId` VARCHAR(191) NULL,
    `supplierId` VARCHAR(191) NULL,
    `durationDays` INTEGER NOT NULL,
    `targetDate` DATETIME(3) NOT NULL,
    `doneDate` DATETIME(3) NULL,
    `status` ENUM('BELUM', 'PROSES', 'SELESAI') NOT NULL DEFAULT 'BELUM',
    `note` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PlanStageStep_planStageId_idx`(`planStageId`),
    INDEX `PlanStageStep_status_targetDate_idx`(`status`, `targetDate`),
    INDEX `PlanStageStep_supplierId_idx`(`supplierId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `PurchaseOrder_planStageId_idx` ON `PurchaseOrder`(`planStageId`);

