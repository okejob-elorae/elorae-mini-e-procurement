-- Real database foreign keys on the field-sales order relations that never had one.
--
-- These relations are declared under `relationMode = "prisma"`, which suppresses the FKs Prisma
-- would generate. Prisma emulates a declared relation's ON DELETE action on its own client deletes,
-- but it never checks that a parent exists on insert or update, and raw SQL bypasses it entirely.
-- Four of the columns below (`approvedById`, `rejectedById`, `closedById`, `creditOverrideById`)
-- have no Prisma relation at all, so nothing protected them. Meanwhile the delivery tables these
-- orders feed already carry real FKs (`FieldSalesDelivery_deliveredById_fkey`,
-- `FieldSalesDeliveryLine_itemId_fkey`, added in 20260809120000_add_field_sales_delivery), so a
-- dangling order reference stayed invisible until it broke a delivery write.
--
-- ON DELETE matches what Prisma already emulates for each relation, so the database and the client
-- agree: RESTRICT for the required relations (storeId, salesmanId, itemId), SET NULL for the
-- optional ones (visitId, addedById), CASCADE for the order's own lines (declared
-- `onDelete: Cascade`). The four relation-less actor columns get RESTRICT, like
-- `FieldSalesDelivery.deliveredById`: they record who approved, rejected, closed or overrode an
-- order, and erasing that silently is worse than refusing the delete. Nothing in the app deletes a
-- User (accounts are deactivated), and `deleteItem` already counts `FieldSalesOrderLine`.
-- ON UPDATE CASCADE everywhere, as in 20260809120000.
--
-- Every referencing column is VARCHAR(191) in a utf8mb4_unicode_ci table, the same as each
-- referenced `id`. No index is added by hand: storeId, salesmanId, orderId and itemId already lead
-- an index Prisma declares, and InnoDB creates one named after the constraint for the other six,
-- exactly as it did for `FieldSalesDelivery_deliveredById_fkey`.
--
-- PRE-FLIGHT: adding an FK fails on any existing row whose value matches no parent. The guard below
-- aborts the file with ERROR 1242 before any DDL runs if such a row exists, using the
-- self-aborting pattern proven by 20260809130000_backfill_field_sales_deliveries. The same check,
-- itemised per relation, is the read-only `scripts/audit-field-sales-orphans.sql`; run it first and
-- it must return zero rows in sections 1-10. If the guard aborts, repair or delete the rows the
-- audit names, then apply again. The prod deploy pipes this file through the `mariadb` CLI and
-- records it only on success, so an abort there leaves nothing recorded and the next deploy simply
-- re-runs it. `prisma migrate deploy` (the local test bed) records it as failed instead: run
-- `prisma migrate resolve --rolled-back 20261021100000_field_sales_foreign_keys` before re-running.
--
-- Each table gets ONE ALTER so its constraints land together or not at all. If the second ALTER
-- fails after the first succeeded, drop the seven `FieldSalesOrder_*_fkey` constraints by hand
-- before re-running, or the re-run stops on a duplicate constraint name.

SELECT IF(
  (SELECT COUNT(*) FROM `FieldSalesOrder` o
    WHERE NOT EXISTS (SELECT 1 FROM `Store` s WHERE s.`id` = o.`storeId`)
      OR NOT EXISTS (SELECT 1 FROM `User` u WHERE u.`id` = o.`salesmanId`)
      OR (o.`visitId` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `StoreVisit` v WHERE v.`id` = o.`visitId`))
      OR (o.`approvedById` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `User` u WHERE u.`id` = o.`approvedById`))
      OR (o.`rejectedById` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `User` u WHERE u.`id` = o.`rejectedById`))
      OR (o.`closedById` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `User` u WHERE u.`id` = o.`closedById`))
      OR (o.`creditOverrideById` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `User` u WHERE u.`id` = o.`creditOverrideById`))
  ) + (SELECT COUNT(*) FROM `FieldSalesOrderLine` l
    WHERE NOT EXISTS (SELECT 1 FROM `FieldSalesOrder` o WHERE o.`id` = l.`orderId`)
      OR NOT EXISTS (SELECT 1 FROM `Item` i WHERE i.`id` = l.`itemId`)
      OR (l.`addedById` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `User` u WHERE u.`id` = l.`addedById`))
  ) = 0,
  'preflight ok',
  (SELECT 'ABORT' UNION ALL SELECT 'ABORT')
) AS preflight_field_sales_orphans;

-- AddForeignKey
ALTER TABLE `FieldSalesOrder`
  ADD CONSTRAINT `FieldSalesOrder_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `Store`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `FieldSalesOrder_salesmanId_fkey` FOREIGN KEY (`salesmanId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `FieldSalesOrder_visitId_fkey` FOREIGN KEY (`visitId`) REFERENCES `StoreVisit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `FieldSalesOrder_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `FieldSalesOrder_rejectedById_fkey` FOREIGN KEY (`rejectedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `FieldSalesOrder_closedById_fkey` FOREIGN KEY (`closedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `FieldSalesOrder_creditOverrideById_fkey` FOREIGN KEY (`creditOverrideById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FieldSalesOrderLine`
  ADD CONSTRAINT `FieldSalesOrderLine_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `FieldSalesOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `FieldSalesOrderLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `FieldSalesOrderLine_addedById_fkey` FOREIGN KEY (`addedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
