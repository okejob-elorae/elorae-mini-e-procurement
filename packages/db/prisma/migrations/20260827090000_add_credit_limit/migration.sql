-- Per-store credit limit + per-order credit-check audit trail. Order creation stays
-- permissive — an over-limit putus order is still written and still reserves stock, stamped
-- with an advisory flag and a create-time snapshot. The real gate is at approve, where exposure
-- is recomputed live and the approve is refused unless an override reason is supplied. See
-- docs/superpowers/specs/2026-08-27-credit-limit-enforcement-design.md.
--
-- Store.creditLimit: NULL = no limit configured (check skipped, the default for every existing
-- store — additive, no backfill, feature ships dark). 0 = a genuine zero limit (every credit
-- order needs an override), which is why NULL must mean unlimited rather than overloading 0.
--
-- Re-runnable: a migration recorded as failed blocks every later deploy until
-- `prisma migrate resolve --rolled-back 20260827090000_add_credit_limit`, and idempotent SQL is
-- what makes re-running that recovery safe. No FOREIGN KEY: relationMode = "prisma".

ALTER TABLE `Store` ADD COLUMN IF NOT EXISTS `creditLimit` DECIMAL(15, 2) NULL;

ALTER TABLE `FieldSalesOrder` ADD COLUMN IF NOT EXISTS `creditHoldAtCreate` BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE `FieldSalesOrder` ADD COLUMN IF NOT EXISTS `creditExposureAtCreate` DECIMAL(15, 2) NULL;
ALTER TABLE `FieldSalesOrder` ADD COLUMN IF NOT EXISTS `creditLimitAtCreate` DECIMAL(15, 2) NULL;
ALTER TABLE `FieldSalesOrder` ADD COLUMN IF NOT EXISTS `creditExposureAtApprove` DECIMAL(15, 2) NULL;
ALTER TABLE `FieldSalesOrder` ADD COLUMN IF NOT EXISTS `creditLimitAtApprove` DECIMAL(15, 2) NULL;
ALTER TABLE `FieldSalesOrder` ADD COLUMN IF NOT EXISTS `creditOverrideReason` TEXT NULL;
ALTER TABLE `FieldSalesOrder` ADD COLUMN IF NOT EXISTS `creditOverrideById` VARCHAR(191) NULL;
ALTER TABLE `FieldSalesOrder` ADD COLUMN IF NOT EXISTS `creditOverrideAt` DATETIME(3) NULL;
