-- Pins each stock reservation to the InventoryValue row it was made against, so consume and
-- release act on that row even if a second variantless row is provisioned in between.
-- Nullable: reservations made before this column fall back to the lookup. Re-runnable.
ALTER TABLE `StockReservation` ADD COLUMN IF NOT EXISTS `inventoryValueId` VARCHAR(191) NULL;
