-- Area toko dan sales penanggung jawab per toko (MariaDB). Setara 14_area_toko
-- di sisi Postgres; alasannya ditulis di sana.
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.
CREATE TABLE `StoreGroup` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StoreGroup_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Store` ADD COLUMN `groupId` VARCHAR(191) NULL,
    ADD COLUMN `salesmanId` VARCHAR(191) NULL;
CREATE INDEX `Store_groupId_idx` ON `Store`(`groupId`);
CREATE INDEX `Store_salesmanId_idx` ON `Store`(`salesmanId`);
