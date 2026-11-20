-- Jenis jasa WO (ServiceType) + tautan ke WorkOrderStep + backfill langkah kosong.

CREATE TABLE `ServiceType` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ServiceType_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `ServiceType` (`id`, `code`, `name`, `isActive`, `sortOrder`, `createdAt`, `updatedAt`) VALUES
('svc-jahit', 'JAHIT', 'Jahit/CMT', true, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
('svc-sablon', 'SABLON', 'Sablon', true, 2, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
('svc-bordir', 'BORDIR', 'Bordir', true, 3, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
('svc-packing', 'PACKING', 'Packing', true, 4, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

ALTER TABLE `WorkOrderStep` ADD COLUMN `serviceTypeId` VARCHAR(191) NULL;
ALTER TABLE `WorkOrderStep` ADD INDEX `WorkOrderStep_serviceTypeId_idx`(`serviceTypeId`);

-- WO tanpa langkah: satu baris jasa nol-harga supaya bisa ditagih setelah qty diisi di terima BJ.
INSERT INTO `WorkOrderStep` (
  `id`, `woId`, `sequence`, `stepName`, `serviceTypeId`, `supplierId`,
  `servicePrice`, `servicePpnIncluded`, `qty`, `totalCost`,
  `createdAt`, `updatedAt`
)
SELECT
  CONCAT('wosbf_', wo.`id`),
  wo.`id`,
  1,
  'Jahit/CMT',
  'svc-jahit',
  wo.`vendorId`,
  0,
  false,
  NULL,
  NULL,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `WorkOrder` wo
WHERE wo.`status` <> 'CANCELLED'
  AND NOT EXISTS (SELECT 1 FROM `WorkOrderStep` s WHERE s.`woId` = wo.`id`);

-- Petakan nama tahap lama ke jenis jasa (kode atau nama).
UPDATE `WorkOrderStep` s
INNER JOIN `ServiceType` st
  ON BINARY UPPER(TRIM(s.`stepName`)) = BINARY st.`code`
  OR BINARY TRIM(s.`stepName`) = BINARY st.`name`
SET s.`serviceTypeId` = st.`id`
WHERE s.`serviceTypeId` IS NULL
  AND s.`stepName` IS NOT NULL
  AND TRIM(s.`stepName`) <> '';

-- Nama yang tidak cocok seed: jatuh ke Jahit/CMT supaya tidak NULL selamanya.
UPDATE `WorkOrderStep`
SET `serviceTypeId` = 'svc-jahit'
WHERE `serviceTypeId` IS NULL;

ALTER TABLE `WorkOrderStep`
  ADD CONSTRAINT `WorkOrderStep_serviceTypeId_fkey`
  FOREIGN KEY IF NOT EXISTS (`serviceTypeId`) REFERENCES `ServiceType`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
