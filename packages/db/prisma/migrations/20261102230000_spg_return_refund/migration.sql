-- SPG shopper returns: set-aside goods, the refund after approval, and the SPG charge (owner answers
-- 2026-11-02: P12 "di sisihkan dahulu", P13 the refund is allowed only after the office approves —
-- a refund made before that is the SPG's fault and she compensates, P13a the report is filed with
-- the money NOT yet refunded and the phone tells her to refund after approval, P14 photos are
-- mandatory, P77 goods photo at report + refund-slip photo whenever the money is refunded, P78 the
-- office may mark "uang ternyata sudah dikembalikan" when rejecting (reason required), P79 once the
-- SPG has compensated the office chooses: her money back with the goods into stock, or the goods
-- are bought by her, P80 no store credit, P81 the charge is the net price on her SPG nota and the
-- office may set the slip amount with a reason, P82 a mistaken rejection may be reversed with a
-- reason while nothing has been taken from her, P83 rejected without a refund: the goods go back to
-- the shopper). Writers: apps/web/lib/spg/retur-pembeli.ts and apps/web/lib/spg/beban-spg-writer.ts.
--
-- SpgSaleReturn:
--   goodsPhotoR2Key: the mandatory goods photo, `spg-sale-returns/<storeId>/<report key>/barang.<ext>`.
--   refundedAt: when the cashier refunded the shopper, as recorded by the SPG (at report, while
--     waiting, or after approval). NULL = not refunded yet, or only marked by the office (P78).
--   refundSlipR2Key: the refund-slip photo, `.../struk.<ext>`; required whenever refundedAt is set.
--   refundMarkedById / refundMarkReason: the office marked at rejection that the money had been
--     refunded after all (P78); refundedAt stays NULL because the refund day is unknown.
--   status DEFAULT changes from 'DISETUJUI' to 'MENUNGGU': a forgotten status is a pending report,
--     never an approved one without its effects. The old default was the round-3 backfill for rows
--     that took effect at insert; the master image has no SpgSaleReturn table at all and no SPG sale
--     or return has ever been made for real, so no row depends on it. Every writer names the status.
--   (storeId, refundedAt) serves the day close, which counts an approved return on its refund day.
--
-- SpgCharge: one per rejected report whose money was refunded (source 'RETUR_PEMBELI', sourceId =
-- the report id, unique). amount = what she owes (computedAmount = the net nota price, or the slip
-- amount the office set with amountReason). settledAmount = what has been deducted from her pay or
-- moved to her SPG debt. status TERBUKA | LUNAS (fully deducted from pay) | DIUTANGKAN (the rest was
-- moved to SpgDebt at her final payment; compensated only once that debt is paid) | BATAL (a
-- reversed rejection, P82). goodsDecision KEMBALI_STOK | DIBELI_SPG (P79, once). paybackAmount is
-- her money returned on the next payment after KEMBALI_STOK. sourceKind PUTUS | KONSI = the store's
-- terms at creation (journal channel), spgSaleId / reportedAt are snapshots so the charge readers
-- never read the report table.
-- SpgChargeDeduction: one per charge per paid row (ConsignmentCommission / SpgCommission / SpgDebt);
-- the unique key is the database backstop against deducting twice in one payment.
--
-- No backfill: no SPG sale or return exists on prod and every new column is nullable or defaulted.
-- No FOREIGN KEY (relationMode = "prisma"). Additive (plus the default change) and re-runnable.

ALTER TABLE `SpgSaleReturn`
  ADD COLUMN IF NOT EXISTS `goodsPhotoR2Key` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `refundedAt` DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS `refundSlipR2Key` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `refundMarkedById` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `refundMarkReason` TEXT NULL;

ALTER TABLE `SpgSaleReturn`
  MODIFY COLUMN `status` ENUM('MENUNGGU', 'DISETUJUI', 'DITOLAK', 'DIBATALKAN') NOT NULL DEFAULT 'MENUNGGU';

CREATE INDEX IF NOT EXISTS `SpgSaleReturn_storeId_refundedAt_idx` ON `SpgSaleReturn`(`storeId`, `refundedAt`);

CREATE TABLE IF NOT EXISTS `SpgCharge` (
  `id` VARCHAR(191) NOT NULL,
  `spgUserId` VARCHAR(191) NOT NULL,
  `storeId` VARCHAR(191) NOT NULL,
  `sourceKind` VARCHAR(10) NOT NULL,
  `source` VARCHAR(40) NOT NULL,
  `sourceId` VARCHAR(191) NOT NULL,
  `sourceDocNo` VARCHAR(191) NOT NULL,
  `spgSaleId` VARCHAR(191) NOT NULL,
  `reportedAt` DATETIME(3) NOT NULL,
  `computedAmount` DECIMAL(15,2) NOT NULL,
  `amount` DECIMAL(15,2) NOT NULL,
  `amountReason` TEXT NULL,
  `settledAmount` DECIMAL(15,2) NOT NULL DEFAULT 0,
  `settledAt` DATETIME(3) NULL,
  `status` VARCHAR(10) NOT NULL DEFAULT 'TERBUKA',
  `cancelledAt` DATETIME(3) NULL,
  `cancelledById` VARCHAR(191) NULL,
  `cancelReason` TEXT NULL,
  `goodsDecision` VARCHAR(12) NULL,
  `goodsDecidedAt` DATETIME(3) NULL,
  `goodsDecidedById` VARCHAR(191) NULL,
  `goodsDecisionNote` TEXT NULL,
  `paybackAmount` DECIMAL(15,2) NOT NULL DEFAULT 0,
  `paybackPaidAt` DATETIME(3) NULL,
  `paybackPaidRefType` VARCHAR(40) NULL,
  `paybackPaidRefId` VARCHAR(191) NULL,
  `paybackPayoutMonth` VARCHAR(7) NULL,
  `note` TEXT NOT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `SpgCharge_source_sourceId_key`(`source`, `sourceId`),
  INDEX `SpgCharge_spgUserId_status_idx`(`spgUserId`, `status`),
  INDEX `SpgCharge_spgUserId_paybackPaidAt_idx`(`spgUserId`, `paybackPaidAt`),
  INDEX `SpgCharge_status_goodsDecision_idx`(`status`, `goodsDecision`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `SpgChargeDeduction` (
  `id` VARCHAR(191) NOT NULL,
  `chargeId` VARCHAR(191) NOT NULL,
  `amount` DECIMAL(15,2) NOT NULL,
  `fromCommission` DECIMAL(15,2) NOT NULL,
  `fromSalary` DECIMAL(15,2) NOT NULL,
  `paidRefType` VARCHAR(40) NOT NULL,
  `paidRefId` VARCHAR(191) NOT NULL,
  `payoutMonth` VARCHAR(7) NOT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `SpgChargeDeduction_chargeId_paidRefType_paidRefId_key`(`chargeId`, `paidRefType`, `paidRefId`),
  INDEX `SpgChargeDeduction_paidRefType_paidRefId_idx`(`paidRefType`, `paidRefId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
