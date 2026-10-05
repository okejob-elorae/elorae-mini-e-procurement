-- Pembayaran toko per siklus konsinyasi (MariaDB).
-- Setara 30_pembayaran_toko_konsi di sisi Postgres; alasannya ditulis di sana.
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.

CREATE TABLE IF NOT EXISTS `ConsignmentPayment` (
    `id` VARCHAR(191) NOT NULL,
    `cycleId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `paidOn` DATETIME(3) NOT NULL,
    `method` VARCHAR(191) NOT NULL DEFAULT 'transfer',
    `note` TEXT NULL,
    `recordedById` VARCHAR(191) NOT NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelledById` VARCHAR(191) NULL,
    `cancelReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ConsignmentPayment_cycleId_idx`(`cycleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
