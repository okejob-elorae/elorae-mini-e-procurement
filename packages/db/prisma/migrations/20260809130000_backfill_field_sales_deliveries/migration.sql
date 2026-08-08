-- Backfill: give every pre-existing APPROVED putus order the one full FieldSalesDelivery it
-- never got, because delivery is a new concept as of migration 20260809120000_add_field_sales_delivery.
-- Every such order already consumed its stock and wrote its SalesHistory at the moment it was
-- approved (the old approve path, before delivery existed) — this migration writes NO stock
-- movement, NO StockAdjustment, and NO SalesHistory. Doing so again would double-count both
-- inventory and revenue. It only creates the delivery/line rows that document what already
-- happened, and updates the tracking columns (deliveredQty, deliveryStatus, consumedQty) that
-- Task 1 added to describe delivery progress, so every order — old or new — reads consistently.
--
-- This file is applied unattended by `prisma migrate deploy` (on prod, automatically on every
-- push to master), so the pre-flight below cannot be a comment asking a human to check a number —
-- it has to make the file itself refuse to run.
--
-- RECOVERY IF THE PRE-FLIGHT ABORTS: `prisma migrate deploy` records this migration in
-- `_prisma_migrations` BEFORE applying it, so an aborted run leaves it marked failed — it is NOT
-- simply "nothing happened, re-run the file." Every later `migrate deploy` will itself fail with
-- P3009 ("migrate found failed migrations") until someone runs, by hand:
--   prisma migrate resolve --rolled-back 20260809130000_backfill_field_sales_deliveries
-- Do that FIRST, then fix the offending FieldSalesOrder/Store/User/Item rows the pre-flight named,
-- then re-run `migrate deploy` (which re-applies this file from the top). On prod the migrate job
-- gates the deploy job, so an abort halts the whole deploy pipeline until this is resolved.
--
-- ============================================================================================
-- PRE-FLIGHT (self-enforcing): every APPROVED putus order this migration would touch must have
-- every reference the backfilled rows depend on resolvable, because none of the source columns
-- below carry a DB-level foreign key (FieldSalesOrder.storeId/approvedById, and
-- FieldSalesOrderLine.itemId, are all `relationMode = "prisma"`) while the DESTINATION columns
-- this migration writes into DO — `FieldSalesDelivery.deliveredById` and
-- `FieldSalesDeliveryLine.itemId` are real, enforced foreign keys. A dangling source reference is
-- invisible today and only surfaces as a foreign-key violation mid-migration, or worse, as a
-- silent skip:
--   - `approvedById IS NULL` / `approvedAt IS NULL` — the backfilled delivery attributes itself to
--     that user, and FieldSalesDelivery.deliveredById is NOT NULL; the salesman did not deliver
--     these orders, and stamping a system placeholder would be a lie in an audit column.
--     `approvedAt` also feeds FOUR NOT NULL columns below (deliveredAt, invoiceDate, dueDate via
--     DATE_ADD, createdAt) — DATE_ADD(NULL, …) is NULL, and MariaDB strict mode raises ERROR 1048
--     mid-INSERT if it ever reached that far.
--   - a dangling `storeId` (Store row deleted) — statement 2's `JOIN Store` silently DROPS such an
--     order instead of erroring, which sounds safe but is not: with the round-1 fix, an order this
--     INSERT skips gets no `bf_` delivery and is never marked DELIVERED, which is correct EXCEPT
--     the order is then indistinguishable from one nobody has looked at yet — `recordFieldSalesDelivery`
--     would happily "deliver" it later, running `consumeFieldSalesOrderPartial` against stock this
--     order already consumed at approve, and writing `SalesHistory` revenue a SECOND time. Catching
--     it here, loudly, is the only safe option — NOT switching the join to `LEFT JOIN Store`, which
--     would silently date the invoice at payment tempo 0 instead of failing.
--   - a dangling `approvedById` that no longer resolves to a `User` row — would violate
--     `FieldSalesDelivery_deliveredById_fkey` at statement 2.
--   - a dangling order-line `itemId` that no longer resolves to an `Item` row — would violate
--     `FieldSalesDeliveryLine_itemId_fkey` at statement 3, AFTER statement 2 has already committed
--     a delivery header with no lines under it.
--
-- The trick below is an intentional abuse of MariaDB scalar-subquery semantics, not a real
-- pre-flight query: `IF(<count> = 0, 'ok', (SELECT 'ABORT' UNION ALL SELECT 'ABORT'))` returns the
-- literal 'ok' when the guard is satisfied, but when it is not, the ELSE branch is a subquery that
-- yields two rows where a scalar is required — MariaDB raises ERROR 1242 ("Subquery returns more
-- than 1 row") and the whole file stops before the first write. This depends on MariaDB NOT
-- pre-evaluating the uncorrelated constant ELSE subquery at optimize time — UNPROVEN on the real
-- server as of this migration being written. Before this migration is first applied anywhere, run
-- this in isolation and confirm it ALSO errors 1242 (proving the trick fires on a true condition,
-- not just a false one):
--   SELECT IF(1 = 1, 'preflight ok', (SELECT 'ABORT' UNION ALL SELECT 'ABORT'));
-- If that does NOT error, this guard is inert and must be replaced before relying on it.
--
-- If the real pre-flight below errors, STOP. See "RECOVERY IF THE PRE-FLIGHT ABORTS" above, then
-- fix the offending rows by hand, then re-run `migrate deploy`.
-- ============================================================================================
SELECT IF(
  (SELECT COUNT(*) FROM `FieldSalesOrder` o
    WHERE o.`status` = 'APPROVED' AND o.`orderType` = 'PUTUS'
      AND (
        o.`approvedById` IS NULL
        OR o.`approvedAt` IS NULL
        OR NOT EXISTS (SELECT 1 FROM `Store` s WHERE s.`id` = o.`storeId`)
        OR NOT EXISTS (SELECT 1 FROM `User` u WHERE u.`id` = o.`approvedById`)
        OR EXISTS (
          SELECT 1 FROM `FieldSalesOrderLine` l
          WHERE l.`orderId` = o.`id`
            AND NOT EXISTS (SELECT 1 FROM `Item` i WHERE i.`id` = l.`itemId`)
        )
      )) = 0,
  'preflight ok',
  (SELECT 'ABORT' UNION ALL SELECT 'ABORT')
) AS preflight_orders_with_unsafe_references;

-- Backfill one FieldSalesDelivery per approved putus order that doesn't have one yet. `docNo` is
-- deliberately the order's own `orderNo`, not a synthetic `DLV/...` number: a backfilled delivery
-- *is* the whole order, and borrowing its number says so honestly, and keys it identically to the
-- SalesHistory rows the original approve already wrote under that same order number. No code may
-- assume a FieldSalesDelivery.docNo starts with `DLV/` — a backfilled row never will.
-- `NOT EXISTS` makes this re-runnable: a partially-applied run leaves no duplicate on retry.
-- `approvedAt IS NOT NULL` is enforced again here (belt-and-braces with the pre-flight above) so
-- this INSERT can never itself attempt to write a NULL into a NOT NULL date column.
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
  AND o.`approvedAt` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `FieldSalesDelivery` d WHERE d.`orderId` = o.`id`);

-- Backfill the delivery lines to mirror the order lines exactly (full quantity, no split). The
-- id is derived the same deterministic way (`bf_<orderLineId>`) so a retry finds the existing row
-- via NOT EXISTS on `orderLineId` rather than colliding on `id` first. Note this INSERT does NOT
-- require the order to have gained a delivery row in THIS statement's own execution — if the
-- delivery insert above already ran in an earlier partial attempt, `CONCAT('bf_', o.id)` below
-- still resolves to that existing row's id — but it DOES require a `bf_` delivery row to exist for
-- this order AT ALL (`EXISTS` below): an order that already carries a real, non-backfilled
-- delivery for some of its lines was excluded from the INSERT above (its `orderId` already has a
-- delivery, just not a `bf_` one), so any of its still-undelivered lines would otherwise pass this
-- statement's own filters and try to insert a line pointing at a `bf_<orderId>` delivery row that
-- was never created — a foreign-key violation on `FieldSalesDeliveryLine_deliveryId_fkey`. The
-- `EXISTS` guard makes that impossible: a line only backfills when its order's `bf_` header exists.
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
  AND o.`approvedAt` IS NOT NULL
  AND EXISTS (SELECT 1 FROM `FieldSalesDelivery` d WHERE d.`id` = CONCAT('bf_', o.`id`))
  AND NOT EXISTS (SELECT 1 FROM `FieldSalesDeliveryLine` dl WHERE dl.`orderLineId` = l.`id`);

-- Mark every line as fully delivered — but ONLY the lines this migration (this run or an earlier
-- partial one) actually backfilled a delivery line for. Deriving the row set from the deterministic
-- `bf_` id, rather than re-stating the status/orderType/approvedById predicate, ties this UPDATE to
-- the INSERT that justifies it instead of letting the two drift:
--   - an order with a NULL approver (or NULL approvedAt) never gets a `FieldSalesDeliveryLine` row,
--     so the JOIN below simply excludes it — no separate approvedById filter to remember here.
--   - an order whose Store row is missing (no DB-level FK on FieldSalesOrder.storeId) is silently
--     dropped by the INSERT's inner JOIN on Store; the JOIN below excludes it the same way, instead
--     of this UPDATE stamping it delivered anyway.
--   - re-run after the feature is LIVE: a genuinely partial delivery (e.g. 3 of 10 shipped) has no
--     `bf_` delivery line for the remaining 7, because a real delivery — not this migration — wrote
--     its own non-`bf_` rows for what actually shipped. The JOIN only matches rows this migration
--     itself created, so a live partial order is never overwritten to fully delivered.
-- Setting deliveredQty = qty a second time on an already-backfilled row is a no-op, so this is
-- naturally re-runnable.
UPDATE `FieldSalesOrderLine` l
JOIN `FieldSalesDeliveryLine` dl ON dl.`id` = CONCAT('bf_', l.`id`)
SET l.`deliveredQty` = l.`qty`;

-- Mark every backfilled order DELIVERED — same reasoning as above, joined off the backfilled
-- delivery row itself (`bf_<orderId>`) rather than a repeated status/orderType/approver predicate.
UPDATE `FieldSalesOrder` o
JOIN `FieldSalesDelivery` d ON d.`id` = CONCAT('bf_', o.`id`)
SET o.`deliveryStatus` = 'DELIVERED';

-- Mark the reservation each backfilled line already consumed at the original approve as fully
-- consumed, so StockReservation.consumedQty (added by Task 1) agrees with the CONSUMED state these
-- rows have carried since before delivery existed. Joined off the backfilled delivery line (not a
-- restated order predicate) for the same reason as the two UPDATEs above — this can never touch a
-- reservation belonging to a line that was never backfilled, including one mid-way through a real
-- partial delivery on a re-run. `orderType = 'PUTUS'` is no longer needed here as a separate filter:
-- only PUTUS orders ever get a `bf_` FieldSalesDeliveryLine row, so the JOIN chain already implies it.
UPDATE `StockReservation` r
JOIN `FieldSalesOrderLine` l ON l.`id` = r.`fieldSalesLineId`
JOIN `FieldSalesDeliveryLine` dl ON dl.`id` = CONCAT('bf_', l.`id`)
SET r.`consumedQty` = r.`qty`
WHERE r.`state` = 'CONSUMED' AND r.`source` = 'FIELD_SALES';
