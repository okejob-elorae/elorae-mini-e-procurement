-- Delivery shipment tracking (EPIC-20, expedition-first slice): the logistics lifecycle
-- PACKED -> IN_TRANSIT -> DELIVERED/PARTIALLY_DELIVERED, in front of the existing
-- FieldSalesDelivery writer. Completion calls recordFieldSalesDelivery with the actually
-- delivered quantities and stores the resulting id in deliveryId -- FieldSalesDelivery
-- itself is untouched. See
-- docs/superpowers/specs/2026-09-03-delivery-logistics-design.md.
--
-- No FOREIGN KEY: relationMode = "prisma". Additive, no backfill.

CREATE TABLE IF NOT EXISTS `DeliveryShipment` (
  `id` VARCHAR(191) NOT NULL,
  `docNo` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `method` ENUM('EXPEDITION', 'SALESMAN_CARRY') NOT NULL,
  `status` ENUM('PACKED', 'IN_TRANSIT', 'DELIVERED', 'PARTIALLY_DELIVERED', 'CANCELLED') NOT NULL DEFAULT 'PACKED',
  `carrierName` VARCHAR(191) NULL,
  `resiNumber` VARCHAR(191) NULL,
  `proofPhotoUrl` VARCHAR(191) NULL,
  `proofPhotoR2Key` VARCHAR(191) NULL,
  `packedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `packedById` VARCHAR(191) NOT NULL,
  `shippedAt` DATETIME(3) NULL,
  `shippedById` VARCHAR(191) NULL,
  `deliveredAt` DATETIME(3) NULL,
  `deliveredById` VARCHAR(191) NULL,
  `deliveryId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `DeliveryShipment_docNo_key`(`docNo`),
  UNIQUE INDEX `DeliveryShipment_deliveryId_key`(`deliveryId`),
  INDEX `DeliveryShipment_orderId_idx`(`orderId`),
  INDEX `DeliveryShipment_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `DeliveryShipmentLine` (
  `id` VARCHAR(191) NOT NULL,
  `shipmentId` VARCHAR(191) NOT NULL,
  `orderLineId` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
  `plannedQty` INTEGER NOT NULL,
  `deliveredQty` INTEGER NULL,
  INDEX `DeliveryShipmentLine_shipmentId_idx`(`shipmentId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
