-- SPG commission split snapshot: the per-SPG POS units an approved konsi sell-through report
-- counted, one row per line x SPG x share (OWN from its own window, LATE carried from the
-- previous report's), written by approve in its own transaction. The commission recap reads these
-- instead of re-reading the live ledger, so a ledger row that commits after approval can no longer
-- shift a closed month's split. Commission amounts are still never stored.
-- `spgSplitSnapshotAt` marks a report whose split was snapshotted (zero rows included); a report
-- approved before this migration keeps it NULL and the recap derives its split live, as before.
-- No FOREIGN KEY: relationMode = "prisma", and nothing deletes a report outside the specs.
-- Additive, no backfill. Re-runnable: CREATE TABLE and the column add are IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS `KonsiSellThroughSpgShare` (
  `id` VARCHAR(191) NOT NULL,
  `sellThroughId` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `variantSku` VARCHAR(191) NOT NULL DEFAULT '',
  `salesmanId` VARCHAR(191) NOT NULL,
  `share` ENUM('OWN', 'LATE') NOT NULL,
  `units` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `KonsiSellThroughSpgShare_split_key`(`sellThroughId`, `itemId`, `variantSku`, `salesmanId`, `share`),
  INDEX `KonsiSellThroughSpgShare_sellThroughId_idx`(`sellThroughId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `KonsiSellThrough` ADD COLUMN IF NOT EXISTS `spgSplitSnapshotAt` DATETIME(3) NULL;
