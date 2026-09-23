-- Konsi stock now moves at delivery-shipment completion instead of at order approve: one
-- KonsiTransfer per completed shipment, linked by the new nullable unique shipmentId (MySQL treats
-- multiple NULLs as distinct, so legacy approve-time transfers all keep NULL). No FOREIGN KEY:
-- relationMode = "prisma".
--
-- Legacy backfill: every APPROVED konsi order was settled under the old model — either transferred
-- in full at approve, or approved before the transfer document existed and never delivered through
-- anything — so every line is marked delivered to its full qty and the order DELIVERED; remaining-qty
-- arithmetic then reads 0 and no shipment can be packed against a legacy order. Where a transfer
-- exists, its StockReservation rows are already CONSUMED from approve.

ALTER TABLE `KonsiTransfer` ADD COLUMN `shipmentId` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `KonsiTransfer_shipmentId_key` ON `KonsiTransfer`(`shipmentId`);

UPDATE `FieldSalesOrderLine` l
JOIN `FieldSalesOrder` o ON o.`id` = l.`orderId`
SET l.`deliveredQty` = l.`qty`
WHERE o.`orderType` = 'KONSI' AND o.`status` = 'APPROVED';

UPDATE `FieldSalesOrder`
SET `deliveryStatus` = 'DELIVERED'
WHERE `orderType` = 'KONSI' AND `status` = 'APPROVED';
