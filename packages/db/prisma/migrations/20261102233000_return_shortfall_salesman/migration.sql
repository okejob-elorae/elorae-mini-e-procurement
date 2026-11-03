-- Store-return shortfalls: the holding salesman's check, follow-up counts, and cuts from his
-- commission (owner answers 2026-11-02: P22 the salesman asks the store AND its SPG and bears the
-- shortfall when the goods are not found; P22a found goods are simply sent back; P84 the store may
-- bear it too (it stays open on the original invoice, decision 1 of 2026-10-29) and a "borne by the
-- company" option is needed; P85 the CURRENT holder asks and the office picks the person when it
-- decides; P86 the salesman's charge is the value on the return note; P87 recorded default: once
-- anything was cut from the bearer, found goods are not recorded as a follow-up of that note).
-- Writers: apps/web/lib/receivables/return-writer.ts and apps/web/lib/receivables/potong-beban-retur.ts.
--
-- WarehouseReturn.followUpOfStoreReturnId: a FOLLOW-UP count of goods found after the shortfall was
--   recorded. storeReturnId stays NULL on such a row (the 1:1 original count keeps its unique key),
--   so a follow-up is never an orphan. The note's physical value = original FINAL count + FINAL
--   follow-ups (`nilaiFisikNota` in apps/web/lib/receivables/deductions.ts).
-- ReturnCharge.checkStatus / checkNote / checkedById / checkedAt: what the current holder reported
--   (DITANYAKAN = not yet, DITEMUKAN, TIDAK_DITEMUKAN with the store's and SPG's answer).
-- ReturnCharge.settledAmount: what has been cut from the bearer's commission (or settled), so a
--   partial monthly cut is possible. A decided charge whose goods all came back keeps its row with
--   amount 0 — no new ReturnChargeStatus value is added, deliberately (see rollback below).
-- ReturnChargeDeduction: one row per cut (positive) or pay-back (negative) per charge; refType
--   'KomisiSalesman', refId '<salesman>:<month>:<screen key>' (pay-backs prefixed 'kembali:').
--
-- Backfill: a LUNAS charge marked by the old "Tandai lunas" reads as fully settled, so it is never
--   read as "nothing cut yet". Prod has no ReturnCharge rows (this module never ran there); dev may.
--
-- Safe while the old image runs: every column is NULL or has a DEFAULT, the table is new, the
-- relation names added in the schema are Prisma-only (relationMode = "prisma", no FOREIGN KEY).
--
-- ROLLBACK OF THE WEB IMAGE after this migration is NOT harmless:
--   (a) the old image reads a charge decided to TOKO as released and credits the store the full
--       claim: SELECT COUNT(*) FROM `ReturnCharge` WHERE `bearer` = 'TOKO' AND `status` <> 'TERBUKA';
--   (b) the old image reads a follow-up count as an ORPHAN count: its list offers "Jodohkan" on it
--       and its jodohkanRetur checks only storeReturnId, so the same goods can be paired with a
--       second, uncounted note and credited twice. Before rolling back, this must be 0 (or every
--       follow-up detached first): SELECT COUNT(*) FROM `WarehouseReturn` WHERE `followUpOfStoreReturnId` IS NOT NULL;
-- Re-runnable.

ALTER TABLE `WarehouseReturn` ADD COLUMN IF NOT EXISTS `followUpOfStoreReturnId` VARCHAR(191) NULL;

CREATE INDEX IF NOT EXISTS `WarehouseReturn_followUpOfStoreReturnId_idx` ON `WarehouseReturn`(`followUpOfStoreReturnId`);

ALTER TABLE `ReturnCharge`
  ADD COLUMN IF NOT EXISTS `checkStatus` ENUM('DITANYAKAN', 'DITEMUKAN', 'TIDAK_DITEMUKAN') NOT NULL DEFAULT 'DITANYAKAN',
  ADD COLUMN IF NOT EXISTS `checkNote` MEDIUMTEXT NULL,
  ADD COLUMN IF NOT EXISTS `checkedById` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `checkedAt` DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS `settledAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS `ReturnChargeDeduction` (
  `id` VARCHAR(191) NOT NULL,
  `chargeId` VARCHAR(191) NOT NULL,
  `amount` DECIMAL(15, 2) NOT NULL,
  `refType` VARCHAR(191) NOT NULL,
  `refId` VARCHAR(191) NOT NULL,
  `note` MEDIUMTEXT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ReturnChargeDeduction_chargeId_idx`(`chargeId`),
  INDEX `ReturnChargeDeduction_refType_refId_idx`(`refType`, `refId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

UPDATE `ReturnCharge` SET `settledAmount` = `amount` WHERE `status` = 'LUNAS' AND `settledAmount` = 0;
