-- Konsi stock now moves at delivery-shipment completion instead of at order approve: one
-- KonsiTransfer per completed shipment, linked by the new nullable unique shipmentId (MySQL treats
-- multiple NULLs as distinct, so legacy approve-time transfers all keep NULL). No FOREIGN KEY:
-- relationMode = "prisma".
--
-- Legacy backfill: every APPROVED konsi order was already transferred in full at approve, so its
-- lines are marked delivered to the transferred quantity and the order DELIVERED. That makes the
-- remaining-qty arithmetic read 0, so no shipment can be packed against a legacy order and its
-- stock cannot move twice. Their StockReservation rows are already CONSUMED from approve.
-- KonsiTransferLine.qty is DECIMAL(10,2) but approve-time transfers always wrote the whole
-- integer order qty, so ROUND is exact.

ALTER TABLE `KonsiTransfer` ADD COLUMN `shipmentId` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `KonsiTransfer_shipmentId_key` ON `KonsiTransfer`(`shipmentId`);

UPDATE `FieldSalesOrderLine` l
JOIN `FieldSalesOrder` o ON o.`id` = l.`orderId`
JOIN (
  SELECT tl.`orderLineId` AS `orderLineId`, ROUND(SUM(tl.`qty`)) AS `transferred`
  FROM `KonsiTransferLine` tl
  WHERE tl.`orderLineId` IS NOT NULL
  GROUP BY tl.`orderLineId`
) t ON t.`orderLineId` = l.`id`
SET l.`deliveredQty` = t.`transferred`
WHERE o.`orderType` = 'KONSI' AND o.`status` = 'APPROVED';

UPDATE `FieldSalesOrder`
SET `deliveryStatus` = 'DELIVERED'
WHERE `orderType` = 'KONSI' AND `status` = 'APPROVED';
