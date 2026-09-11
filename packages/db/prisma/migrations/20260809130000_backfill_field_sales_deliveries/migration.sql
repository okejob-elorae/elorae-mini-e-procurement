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
-- WHERE TO RUN THE PRE-FLIGHT: both the shared dev bed on :3308 AND prod, not just prod. `:3308` is
-- real shared data, not a scratch DB — spec teardowns in this repo do hard-delete `Store`, `User`,
-- and `Item` rows there, and it already carries known orphan test rows from past partial teardowns.
-- A leaked test order with a dangling reference halts dev `migrate:deploy` with the same P3009 as a
-- prod incident would.
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
-- server as of this migration being written. Before this migration is first applied anywhere
-- (against BOTH the shared dev bed on :3308 and prod — see "WHERE TO RUN THE PRE-FLIGHT" below),
-- run BOTH of these in isolation. Both must hold, or the mechanism is unusable and this guard must
-- be replaced with a plain documented `SELECT` plus a human reading the result before proceeding:
--
--   -- 1. Lazy-branch check — exercises the HEALTHY-database path (condition is TRUE).
--   --    MUST return 'preflight ok' with NO error.
--   --    An error here means MariaDB pre-evaluates the ELSE subquery regardless of the condition,
--   --    so the guard would abort on EVERY database, including a perfectly healthy prod — do not
--   --    ship it in that state.
--   SELECT IF(1 = 1, 'preflight ok', (SELECT 'ABORT' UNION ALL SELECT 'ABORT')) AS lazy_branch_check;
--
--   -- 2. Abort-fires check — exercises the UNHEALTHY-database path (condition is FALSE).
--   --    MUST error 1242 ("Subquery returns more than 1 row").
--   --    Returning a value here (no error) means the guard can never fire and enforces nothing.
--   SELECT IF(1 = 0, 'preflight ok', (SELECT 'ABORT' UNION ALL SELECT 'ABORT')) AS abort_fires_check;
--
-- A SECOND, SEPARATE, ALSO-UNPROVEN ASSUMPTION: even both queries above passing only proves
-- MariaDB's own expression semantics. It does NOT prove that `prisma migrate deploy` tolerates a
-- result-set-returning `SELECT` inside a migration file and correctly propagates an error from one
-- as a failed migration — that is the other half of this guard actually working, end to end, and
-- it is untested. There is no precedent for it in this repo: as of this migration being written,
-- the other 85 migration files contain zero standalone `SELECT` statements. If `migrate deploy`
-- swallows the error, discards the result, or otherwise doesn't fail the migration on ERROR 1242,
-- this guard silently does nothing and every write below runs unguarded.
--
-- If the real pre-flight below errors, STOP. See "RECOVERY IF THE PRE-FLIGHT ABORTS" above, then
-- fix the offending rows by hand, then re-run `migrate deploy`.
--
-- A POST-FLIGHT section at the FOOT of this file lists four verification queries to run after the
-- migration, and documents the deploy-window hazard that the fourth of them detects. The pre-flight
-- proves the migration is safe to start; nothing in this file proves it finished correctly.
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
  -- GREATEST(..., 0) floors the tempo exactly the way `computeDueDate` does. `Store.paymentTempo`
  -- is `Int @default(0)` with no CHECK constraint, so a negative is storable, and a bare COALESCE
  -- would back-date a backfilled invoice below its own issue date.
  DATE_ADD(o.`approvedAt`, INTERVAL GREATEST(COALESCE(s.`paymentTempo`, 0), 0) DAY),
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
--   - re-run BEFORE the feature is live (a partial deploy retry, still within the same rollout that
--     shipped this migration): a genuinely partial delivery (e.g. 3 of 10 shipped) has no `bf_`
--     delivery line for the remaining 7, because a real delivery — not this migration — wrote its
--     own non-`bf_` rows for what actually shipped. The JOIN only matches rows this migration itself
--     created, so a partial order from that window is never overwritten to fully delivered.
-- Setting deliveredQty = qty a second time on an already-backfilled row is a no-op, so this is
-- naturally re-runnable.
--
-- NOT COVERED, and not reachable through the documented P3009 recovery path, but worth naming: a
-- re-run of this file AFTER the feature has been fully live for a while, against an order approved
-- during that time and never delivered. Under the new flow, approve no longer consumes stock or
-- writes SalesHistory — delivery is the only thing that does. Such an order has no `bf_` header
-- today (this migration only runs once, gated by the pre-flight above), but IF this file were ever
-- re-applied by hand well after go-live, it would hand that order a `bf_` header and lines,
-- `deliveredQty = qty`, and `deliveryStatus = 'DELIVERED'` for goods that never left the warehouse
-- — permanently hiding them from `recordFieldSalesDelivery` (its `outstandingQty` would read 0) and
-- leaking the order's still-`RESERVED` reservation, which statement 6 below skips (it only touches
-- `state = 'CONSUMED'` rows). This migration's own guards cannot distinguish "approved before
-- delivery existed, consumed at the old approve path" from "approved after, awaiting its first
-- delivery" — both are just APPROVED PUTUS orders with an approver and no delivery yet. Safe only
-- because this file is meant to run exactly once, immediately after 20260809120000, before any
-- order is ever approved under the new flow.
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

-- ============================================================================================
-- POST-FLIGHT (run by hand, NOT part of this migration). The pre-flight proves it is safe to
-- start; nothing above proves it finished. Run queries 1-3 immediately after `migrate deploy`
-- reports success, on the SAME database it ran against — dev :3308 and prod each need their own
-- pass. Every one of the four must return 0 rows / a count of 0.
--
--   -- 1. Every approved putus order got a delivery.
--   --    Non-zero = orders the backfill skipped. Almost always a dangling `storeId` (statement 2's
--   --    inner JOIN Store drops those silently) or a NULL approvedAt/approvedById that the
--   --    pre-flight should have caught — check those columns on the ids this returns. Such an
--   --    order is INDISTINGUISHABLE from one nobody has delivered yet, so recordFieldSalesDelivery
--   --    would happily consume its stock a second time and write its revenue twice. Fix before the
--   --    app container serves the new code.
--   SELECT COUNT(*) FROM FieldSalesOrder o WHERE o.status='APPROVED' AND o.orderType='PUTUS'
--     AND NOT EXISTS (SELECT 1 FROM FieldSalesDelivery d WHERE d.orderId=o.id);
--
--   -- 2. Every line of those orders got a delivery line.
--   --    Non-zero = a delivery header exists with lines missing under it, so the order's nota
--   --    prints short and its outstanding qty reads above zero — the app would offer to "deliver"
--   --    goods that already left at approve. Statement 3 is re-runnable; re-run it alone.
--   SELECT COUNT(*) FROM FieldSalesOrderLine l JOIN FieldSalesOrder o ON o.id=l.orderId
--    WHERE o.status='APPROVED' AND o.orderType='PUTUS'
--      AND NOT EXISTS (SELECT 1 FROM FieldSalesDeliveryLine dl WHERE dl.orderLineId=l.id);
--
--   -- 3. No stranded reservation on a backfilled line.
--   --    Non-zero = a line this migration marked fully delivered whose reservation is not CONSUMED,
--   --    i.e. stock still counted as reserved for goods that already shipped. That depresses
--   --    `available` for every other order on the same item, permanently, with nothing to release
--   --    it — the order is settled. Investigate the reservation rows before touching them.
--   SELECT COUNT(*) FROM StockReservation r JOIN FieldSalesOrderLine l ON l.id=r.fieldSalesLineId
--    JOIN FieldSalesDeliveryLine dl ON dl.id=CONCAT('bf_',l.id) WHERE r.state <> 'CONSUMED';
--
--   -- 4. Run AFTER the app container swaps. Returns the orders caught in the deploy window below.
--   --    Non-zero = each row is an order stuck behind an "exceeds outstanding" toast; see the
--   --    remedy in the deploy-window note. This is the only query of the four that CANNOT be run
--   --    straight after the migrate job — run it once the new image is serving.
--   SELECT o.id,o.orderNo,o.approvedAt FROM FieldSalesOrder o
--    WHERE o.status='APPROVED' AND o.orderType='PUTUS' AND o.deliveryStatus='PENDING';
--
-- THE DEPLOY WINDOW (a real operational hazard, previously undocumented). The prod `migrate` job
-- runs while the OLD image is still serving; the container swaps 30s-3min later. An order approved
-- inside that window is consumed and SalesHistory'd by the OLD approve path, gets no `bf_` header
-- because this migration has already run, and comes up under the new app as
-- `deliveryStatus = 'PENDING'` with its full quantity outstanding.
--
-- It FAILS CLOSED. The old consume left the reservation at `state = 'CONSUMED'`, so
-- `consumeFieldSalesOrderPartial`'s `state = 'RESERVED'` guard matches nothing and it throws
-- OVER_CONSUME, refusing the delivery. There is no double-consume and no duplicate revenue — the
-- damage is that the order is permanently stuck, and the operator sees only a "quantity exceeds
-- outstanding" toast that explains none of this.
--
-- REMEDY: hand-run statements 2 through 6 of this file scoped to that one order id (add
-- `AND o.id = '<orderId>'` to each), which gives it the same `bf_` delivery, delivered quantities,
-- DELIVERED status and consumedQty every pre-existing order got. Query 4 above is what finds them.
-- Do NOT re-run this file whole after go-live — see the NOT COVERED note above statement 4.
-- ============================================================================================
