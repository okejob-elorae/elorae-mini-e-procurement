-- Backfill: give every pre-existing APPROVED putus order the one full FieldSalesDelivery it
-- never got, because delivery is a new concept as of migration 20260809120000_add_field_sales_delivery.
-- Every such order already consumed its stock and wrote its SalesHistory at the moment it was
-- approved (the old approve path, before delivery existed) — this migration writes NO stock
-- movement, NO StockAdjustment, and NO SalesHistory. Doing so again would double-count both
-- inventory and revenue. It only creates the delivery/line rows that document what already
-- happened, and updates the tracking columns (deliveredQty, deliveryStatus, consumedQty) that
-- Task 1 added to describe delivery progress, so every order — old or new — reads consistently.
--
-- Run the pre-flight SELECT below on its own, first, against the target database, and confirm it
-- reads 0 before applying this migration.
--
-- ============================================================================================
-- PRE-FLIGHT: every APPROVED putus order must have a recorded approver, because the backfilled
-- delivery attributes itself to that user and FieldSalesDelivery.deliveredById is NOT NULL. The
-- salesman did not deliver these orders, and stamping a system placeholder would be a lie in an
-- audit column. If this SELECT returns anything other than 0, STOP. Fix those rows by hand
-- (determine and set the real approver on FieldSalesOrder.approvedById), then re-run this file.
-- ============================================================================================
SELECT COUNT(*) AS orders_without_approver
FROM `FieldSalesOrder`
WHERE `status` = 'APPROVED' AND `orderType` = 'PUTUS' AND `approvedById` IS NULL;

-- Backfill one FieldSalesDelivery per approved putus order that doesn't have one yet. `docNo` is
-- deliberately the order's own `orderNo`, not a synthetic `DLV/...` number: a backfilled delivery
-- *is* the whole order, and borrowing its number says so honestly, and keys it identically to the
-- SalesHistory rows the original approve already wrote under that same order number. No code may
-- assume a FieldSalesDelivery.docNo starts with `DLV/` — a backfilled row never will.
-- `NOT EXISTS` makes this re-runnable: a partially-applied run leaves no duplicate on retry.
INSERT INTO `FieldSalesDelivery`
  (`id`, `docNo`, `orderId`, `deliveredAt`, `deliveredById`, `invoiceDate`, `dueDate`,
   `subtotal`, `discountAmount`, `total`, `note`, `idempotencyKey`, `createdAt`)
SELECT
  CONCAT('bf_', o.`id`),
  o.`orderNo`,
  o.`id`,
  o.`approvedAt`,
  o.`approvedById`,
  o.`approvedAt`,
  DATE_ADD(o.`approvedAt`, INTERVAL COALESCE(s.`paymentTempo`, 0) DAY),
  o.`subtotal`,
  o.`orderDiscountAmount`,
  o.`total`,
  NULL,
  NULL,
  o.`approvedAt`
FROM `FieldSalesOrder` o
JOIN `Store` s ON s.`id` = o.`storeId`
WHERE o.`status` = 'APPROVED'
  AND o.`orderType` = 'PUTUS'
  AND o.`approvedById` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `FieldSalesDelivery` d WHERE d.`orderId` = o.`id`);

-- Backfill the delivery lines to mirror the order lines exactly (full quantity, no split). The
-- id is derived the same deterministic way (`bf_<orderLineId>`) so a retry finds the existing row
-- via NOT EXISTS on `orderLineId` rather than colliding on `id` first.
INSERT INTO `FieldSalesDeliveryLine`
  (`id`, `deliveryId`, `orderLineId`, `itemId`, `variantSku`, `productName`, `qty`,
   `unitPrice`, `discountAmount`, `lineTotal`)
SELECT
  CONCAT('bf_', l.`id`),
  CONCAT('bf_', o.`id`),
  l.`id`,
  l.`itemId`,
  l.`variantSku`,
  l.`productName`,
  l.`qty`,
  l.`unitPrice`,
  l.`discountAmount`,
  l.`lineTotal`
FROM `FieldSalesOrderLine` l
JOIN `FieldSalesOrder` o ON o.`id` = l.`orderId`
WHERE o.`status` = 'APPROVED'
  AND o.`orderType` = 'PUTUS'
  AND o.`approvedById` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `FieldSalesDeliveryLine` dl WHERE dl.`orderLineId` = l.`id`);

-- Mark every line as fully delivered. Unconditional on the same WHERE (no NOT EXISTS needed):
-- setting deliveredQty = qty a second time on an already-backfilled row is a no-op, not a
-- duplicate, so this statement is naturally re-runnable.
UPDATE `FieldSalesOrderLine` l
JOIN `FieldSalesOrder` o ON o.`id` = l.`orderId`
SET l.`deliveredQty` = l.`qty`
WHERE o.`status` = 'APPROVED' AND o.`orderType` = 'PUTUS' AND o.`approvedById` IS NOT NULL;

-- Mark every backfilled order DELIVERED. Same no-op-on-retry reasoning as above.
UPDATE `FieldSalesOrder` o
SET o.`deliveryStatus` = 'DELIVERED'
WHERE o.`status` = 'APPROVED' AND o.`orderType` = 'PUTUS' AND o.`approvedById` IS NOT NULL;

-- Mark the reservation each line already consumed at the original approve as fully consumed, so
-- StockReservation.consumedQty (added by Task 1) agrees with the CONSUMED state these rows have
-- carried since before delivery existed. Setting consumedQty = qty again on retry is a no-op.
UPDATE `StockReservation` r
JOIN `FieldSalesOrderLine` l ON l.`id` = r.`fieldSalesLineId`
JOIN `FieldSalesOrder` o ON o.`id` = l.`orderId`
SET r.`consumedQty` = r.`qty`
WHERE r.`state` = 'CONSUMED' AND r.`source` = 'FIELD_SALES' AND o.`orderType` = 'PUTUS';
