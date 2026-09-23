-- Konsi stock now moves at delivery-shipment completion instead of at order approve: one
-- KonsiTransfer per completed shipment, linked by the new nullable unique shipmentId (MySQL treats
-- multiple NULLs as distinct, so legacy approve-time transfers all keep NULL). No FOREIGN KEY:
-- relationMode = "prisma".
--
-- Legacy backfill. An APPROVED konsi order approved under the old model belongs to one of three
-- historical populations, told apart per LINE by its StockReservation:
--   (a) transferred in full at approve — the reservation is CONSUMED. Marked delivered.
--   (b) approved before reservations existed — there is no reservation row at all. Marked delivered;
--       the old model had no delivery step, so nothing is still owed to the store.
--   (c) approved after reservations existed but before the transfer document did — the reservation
--       is still RESERVED and reservedQty is still held on main. Left untouched: the line stays an
--       ordinary approved-and-reserved line, shippable or closable from the order detail page, and
--       either path resolves the held reservation through the UI. Marking it delivered would strand
--       that reservedQty permanently.
-- A line with cancelledQty > 0 is also left alone: close-remainder refused konsi orders under the
-- old model, so no legacy line carries one, while a line closed under the new model does and must
-- keep the deliveredQty its shipments actually wrote.
--
-- The order's deliveryStatus becomes DELIVERED only when every one of its lines is fully delivered
-- after the line update; an order holding a population-(c) line keeps its status.
--
-- The two UPDATEs are safe to re-run by construction — that is the remedy for an order the previous
-- web image approved after this migration ran, during the deploy window: the line predicate never
-- touches a line whose reservation is still live, a line already closed, or a line already
-- delivered in full.

ALTER TABLE `KonsiTransfer` ADD COLUMN `shipmentId` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `KonsiTransfer_shipmentId_key` ON `KonsiTransfer`(`shipmentId`);

UPDATE `FieldSalesOrderLine` l
JOIN `FieldSalesOrder` o ON o.`id` = l.`orderId`
SET l.`deliveredQty` = l.`qty`
WHERE o.`orderType` = 'KONSI' AND o.`status` = 'APPROVED'
  AND l.`cancelledQty` = 0
  AND NOT EXISTS (
    SELECT 1 FROM `StockReservation` r
    WHERE r.`fieldSalesLineId` = l.`id` AND r.`state` = 'RESERVED'
  );

UPDATE `FieldSalesOrder` o
SET o.`deliveryStatus` = 'DELIVERED'
WHERE o.`orderType` = 'KONSI' AND o.`status` = 'APPROVED'
  AND NOT EXISTS (
    SELECT 1 FROM `FieldSalesOrderLine` l
    WHERE l.`orderId` = o.`id` AND l.`deliveredQty` < l.`qty`
  );
