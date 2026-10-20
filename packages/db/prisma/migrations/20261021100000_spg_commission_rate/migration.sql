-- SPG commission rate: a flat rupiah amount per piece for one item category, effective from a
-- WIB month ("YYYY-MM") until a later row for the same category takes over. One row per
-- (category, month); the writer upserts on that pair and refuses months already past.
-- No FOREIGN KEY: relationMode = "prisma". The category delete path counts these rows instead.
-- Additive, no backfill.

CREATE TABLE IF NOT EXISTS `SpgCommissionRate` (
  `id` VARCHAR(191) NOT NULL,
  `itemCategoryId` VARCHAR(191) NOT NULL,
  `amountPerPiece` DECIMAL(15, 2) NOT NULL,
  `effectiveFrom` VARCHAR(7) NOT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `SpgCommissionRate_itemCategoryId_effectiveFrom_key`(`itemCategoryId`, `effectiveFrom`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
