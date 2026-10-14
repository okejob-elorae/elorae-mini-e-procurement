-- Colour master for finished-good variants and colour/size-scoped BOM rules (#437).
--
-- VariantColor is the canonical colour list, optionally linked to a Pantone TCX row.
-- VariantColorAlias holds the spellings a variant's `Warna` text may use (Jubelio typos such as
-- `Cppuccino`), keyed by an application-computed match key that is unique across all colours.
--
-- ConsumptionRule gains an optional colour and size scope; null means every colour / every size.
-- The (finishedGoodId, materialId) unique key becomes a plain index, because one material may
-- now carry one rule per non-overlapping scope (overlap is refused in saveConsumptionRules).
-- No FOREIGN KEY: relationMode = "prisma". Additive, no backfill: existing rules stay unscoped.

CREATE TABLE IF NOT EXISTS `VariantColor` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `pantoneTcx` VARCHAR(191) NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `VariantColor_name_key`(`name`),
  INDEX `VariantColor_pantoneTcx_idx`(`pantoneTcx`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `VariantColorAlias` (
  `id` VARCHAR(191) NOT NULL,
  `matchKey` VARCHAR(191) NOT NULL,
  `label` VARCHAR(191) NOT NULL,
  `colorId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `VariantColorAlias_matchKey_key`(`matchKey`),
  INDEX `VariantColorAlias_colorId_idx`(`colorId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ConsumptionRule` ADD COLUMN `colorId` VARCHAR(191) NULL,
  ADD COLUMN `size` VARCHAR(191) NULL;

CREATE INDEX `ConsumptionRule_finishedGoodId_materialId_idx` ON `ConsumptionRule`(`finishedGoodId`, `materialId`);
CREATE INDEX `ConsumptionRule_colorId_idx` ON `ConsumptionRule`(`colorId`);
DROP INDEX `ConsumptionRule_finishedGoodId_materialId_key` ON `ConsumptionRule`;
