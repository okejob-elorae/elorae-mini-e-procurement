ALTER TABLE `DeliveryShipment`
    ADD COLUMN `cancelledAt` DATETIME(3) NULL,
    ADD COLUMN `cancelledById` VARCHAR(191) NULL;

CREATE INDEX `DeliveryShipment_carriedById_idx` ON `DeliveryShipment`(`carriedById`);
