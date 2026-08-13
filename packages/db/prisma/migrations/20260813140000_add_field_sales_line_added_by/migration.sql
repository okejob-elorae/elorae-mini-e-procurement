-- Records that the APPROVER added this line, not the salesman who submitted the order.
-- NULL means the salesman requested it, which is true of every pre-existing row — so there is
-- nothing to backfill.
--
-- Re-runnable: MariaDB supports ADD COLUMN IF NOT EXISTS. That matters because a migration
-- recorded as failed blocks every later deploy until `prisma migrate resolve --rolled-back
-- 20260813140000_add_field_sales_line_added_by`, and idempotent SQL is what makes re-running
-- that recovery safe. No FOREIGN KEY: these relations are `relationMode = "prisma"`.

ALTER TABLE `FieldSalesOrderLine` ADD COLUMN IF NOT EXISTS `addedById` VARCHAR(191) NULL;
