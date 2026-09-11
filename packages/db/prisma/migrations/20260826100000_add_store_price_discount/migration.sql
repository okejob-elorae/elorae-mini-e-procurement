-- Per-store price discount: a PUTUS (outright-sale) store can carry a standing percentage
-- discount off list price, unitPrice = sellingPrice * (1 - priceDiscountPercent/100).
-- `priceDiscountPercent` sits beside `marginPercent` as a sibling price knob; KONSI stores are
-- unaffected and keep using `marginPercent`. NULL means "no adjustment", which is today's
-- behaviour for every existing store, so no backfill is needed.
--
-- Re-runnable: a migration recorded as failed blocks every later deploy until
-- `prisma migrate resolve --rolled-back 20260826100000_add_store_price_discount`, and idempotent
-- SQL is what makes re-running that recovery safe. No FOREIGN KEY: relationMode = "prisma".
-- Additive, no backfill.

ALTER TABLE `Store` ADD COLUMN IF NOT EXISTS `priceDiscountPercent` DECIMAL(5, 2) NULL;
