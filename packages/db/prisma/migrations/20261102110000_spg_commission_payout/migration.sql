-- SpgSalesCheck: the office's "Tandai laporan dicek" for one putus store's SPG sales of one WIB
-- month (owner decision 2026-11-01, Komisi SPG). SPG commission is computed one way everywhere
-- (rate per item category x each SPG's own pieces, apps/web/lib/spg-commission/payout.ts) and is
-- PAID in the month the sales report is checked, with the sales month as its note. A consignment
-- store's report is checked when its cycle's official figures are locked
-- (ConsignmentCycle.lockedAt); a putus store has no such step, so this row is it: its WIB month of
-- `checkedAt` is the payout month of that store x `period`. One row per store x month; unchecking
-- deletes it (allowed only while no commission of that store x month is paid) and the audit row
-- keeps what it said. No FOREIGN KEY: relationMode = "prisma".
--
-- Additive, no backfill: SpgCommission rows set before this change carry no check and stay
-- readable as they are; paying an unpaid one now needs the month checked (and set again).
-- Re-runnable (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS `SpgSalesCheck` (
  `id` VARCHAR(191) NOT NULL,
  `storeId` VARCHAR(191) NOT NULL,
  `period` VARCHAR(7) NOT NULL,
  `checkedById` VARCHAR(191) NOT NULL,
  `checkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `SpgSalesCheck_storeId_period_key`(`storeId`, `period`),
  INDEX `SpgSalesCheck_checkedAt_idx`(`checkedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ConsignmentCommission.salaried: whether a cycle's pay row is a salaried participant (an SPG
-- assigned to the store at the first lock) or only a seller from elsewhere who earns commission on
-- her own sales and no base salary. Commission belongs to whoever sold (rate per item category x
-- own pieces); the base salary belongs to the participants. A re-lock after an unlock keeps each
-- row's flag, so a seller from another store never turns into a salaried participant. Existing
-- rows were all created for assigned SPGs under the old rule, hence DEFAULT true.
ALTER TABLE `ConsignmentCommission` ADD COLUMN IF NOT EXISTS `salaried` BOOLEAN NOT NULL DEFAULT true;
