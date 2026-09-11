-- Salesman-carry POD (EPIC-20 second story): carriedById identifies who actually carries the
-- goods (required at ship time for SALESMAN_CARRY, symmetric with resiNumber for EXPEDITION);
-- invoiceDate/dueDate move to the shipment row for SALESMAN_CARRY, set by the admin at
-- pack/ship time rather than typed by the salesman at completion; gpsLat/gpsLng/
-- gpsDistanceMeters are the audit trail for the GPS hard gate at completion;
-- signatureUrl/signatureR2Key/signedByName are schema-ready for a not-yet-built signature
-- capture UI -- nothing in this slice writes them. See
-- docs/superpowers/specs/2026-09-03-salesman-carry-pod-design.md.
--
-- No FOREIGN KEY: relationMode = "prisma". Additive, no backfill.

ALTER TABLE `DeliveryShipment` ADD COLUMN IF NOT EXISTS `carriedById` VARCHAR(191) NULL;
ALTER TABLE `DeliveryShipment` ADD COLUMN IF NOT EXISTS `invoiceDate` DATETIME(3) NULL;
ALTER TABLE `DeliveryShipment` ADD COLUMN IF NOT EXISTS `dueDate` DATETIME(3) NULL;
ALTER TABLE `DeliveryShipment` ADD COLUMN IF NOT EXISTS `gpsLat` DECIMAL(10, 7) NULL;
ALTER TABLE `DeliveryShipment` ADD COLUMN IF NOT EXISTS `gpsLng` DECIMAL(10, 7) NULL;
ALTER TABLE `DeliveryShipment` ADD COLUMN IF NOT EXISTS `gpsDistanceMeters` INTEGER NULL;
ALTER TABLE `DeliveryShipment` ADD COLUMN IF NOT EXISTS `signatureUrl` VARCHAR(191) NULL;
ALTER TABLE `DeliveryShipment` ADD COLUMN IF NOT EXISTS `signatureR2Key` VARCHAR(191) NULL;
ALTER TABLE `DeliveryShipment` ADD COLUMN IF NOT EXISTS `signedByName` VARCHAR(191) NULL;
