-- Attribution for closing the undelivered remainder of a putus order. Mirrors the
-- rejectedAt/rejectedById/rejectReason trio it sits beside: nullable, no DB-level foreign key on
-- the user id (FieldSalesOrder relations are `relationMode = "prisma"`), reason as TEXT.
-- Before this, closeFieldSalesOrderRemainder appended the admin's reason to FieldSalesOrder.note —
-- the salesman's own PWA note — with no separator and no way to tell the two apart afterwards.

-- AlterTable
ALTER TABLE `FieldSalesOrder` ADD COLUMN `closedAt` DATETIME(3) NULL,
    ADD COLUMN `closedById` VARCHAR(191) NULL,
    ADD COLUMN `closeReason` TEXT NULL;
