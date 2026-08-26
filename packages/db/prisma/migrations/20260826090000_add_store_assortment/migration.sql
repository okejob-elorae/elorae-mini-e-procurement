-- Per-store assortment: the SKU list a consignment store should carry, modelled on
-- PromoStore/PromoItem. Reference data, not a document — no DocType, no status enum.
-- `targetQty` is nullable on purpose: NULL means "must be present at all", a number means
-- "must be present at at least this quantity". The gap query (a later slice) left-joins this
-- against StoreStock on (storeId, itemId, variantSku).
--
-- Re-runnable: a migration recorded as failed blocks every later deploy until
-- `prisma migrate resolve --rolled-back 20260826090000_add_store_assortment`, and idempotent
-- SQL is what makes re-running that recovery safe. No FOREIGN KEY: relationMode = "prisma".
-- Additive, no backfill.

CREATE TABLE IF NOT EXISTS `StoreAssortmentLine` (
  `id` VARCHAR(191) NOT NULL,
  `storeId` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
  `targetQty` DECIMAL(10, 2) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdById` VARCHAR(191) NOT NULL,
  UNIQUE INDEX `StoreAssortmentLine_storeId_itemId_variantSku_key`(`storeId`, `itemId`, `variantSku`),
  INDEX `StoreAssortmentLine_storeId_idx`(`storeId`),
  INDEX `StoreAssortmentLine_itemId_idx`(`itemId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
