-- SpgCommissionCorrection: an SPG commission correction APPLIED on a payout (owner decision
-- 2026-11-02). Commission is one calculation everywhere (category rate of the sales month x each
-- SPG's own net confirmed pieces, apps/web/lib/spg-commission/payout.ts); nothing is split
-- equally. A row not yet paid is paid at today's per-SPG figure. A row ALREADY paid is never
-- changed: its difference (today's per-SPG figure - what was paid - corrections already applied
-- from that report) rides once on that SPG's next payout as its own line, e.g. "Koreksi komisi
-- penjualan September 2026 - Toko X: +Rp 17.500". The difference itself is DERIVED, never stored
-- (apps/web/lib/spg/koreksi.ts); a row here is written only when the payout that applies it is
-- marked paid, in the same transaction, with its audit row. Rows are never updated or deleted.
--
-- Columns:
--   sourceKind        'KONSI' | 'PUTUS'
--   sourceKey         the report: 'konsi:<cycleId>' or 'putus:<storeId>:<YYYY-MM>'
--   sourceStoreId,
--   sourceSalesMonth  the report's store and WIB sales month (journal channel + store, labels)
--   amount            signed rupiah applied by this payout
--   difference        the whole outstanding difference when applied; differs from amount only for a
--                     negative correction cut short so the payout stays >= Rp 0 (the rest stays
--                     derived and lands on the following payout)
--   figure, paidBefore,
--   appliedBefore     snapshots of the formula's terms at application
--   paidRefType       'SpgCommission' | 'ConsignmentCommission' (REF_KOMISI_* in lib/spg/hilang.ts)
--   paidRefId         the paid row the correction rode on
--   payoutMonth       that row's payout month (WIB 'YYYY-MM')
--   note              'Koreksi komisi penjualan <bulan> - <toko>'
--
-- One row per paid row x source report: the unique key is the database backstop against applying
-- the same source twice on one payment. No FOREIGN KEY: relationMode = "prisma".
--
-- Additive, no backfill on purpose: past equal-split payments, shopper returns approved after
-- payment and phone receipts synced after payment all surface as DERIVED pending corrections and
-- land here only when each SPG's next payout is paid. The old image keeps working against this
-- schema (it never reads the table). Re-runnable (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS `SpgCommissionCorrection` (
  `id` VARCHAR(191) NOT NULL,
  `spgUserId` VARCHAR(191) NOT NULL,
  `sourceKind` VARCHAR(10) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `sourceStoreId` VARCHAR(191) NOT NULL,
  `sourceSalesMonth` VARCHAR(7) NOT NULL,
  `amount` DECIMAL(15,2) NOT NULL,
  `difference` DECIMAL(15,2) NOT NULL,
  `figure` DECIMAL(15,2) NOT NULL,
  `paidBefore` DECIMAL(15,2) NOT NULL,
  `appliedBefore` DECIMAL(15,2) NOT NULL,
  `paidRefType` VARCHAR(40) NOT NULL,
  `paidRefId` VARCHAR(191) NOT NULL,
  `payoutMonth` VARCHAR(7) NOT NULL,
  `note` TEXT NOT NULL,
  `appliedById` VARCHAR(191) NOT NULL,
  `appliedAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `SpgCommissionCorrection_paidRefType_paidRefId_sourceKey_key`(`paidRefType`, `paidRefId`, `sourceKey`),
  INDEX `SpgCommissionCorrection_spgUserId_sourceKey_idx`(`spgUserId`, `sourceKey`),
  INDEX `SpgCommissionCorrection_payoutMonth_idx`(`payoutMonth`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
