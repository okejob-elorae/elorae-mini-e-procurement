-- Konsi bills are receivables (owner decision 2026-10-29: "Tagihan konsinyasi MASUK Piutang setelah
-- angka terjual dikunci"; follow-ups P31, P54, P55, P59 of 2026-11-02). Locking a consignment cycle's
-- sold figures (apps/web/lib/konsinyasi/writer.ts `kunciAngka`) creates the cycle's single live
-- Receivable; unlocking (`bukaKunci`) voids it. The store pays it only by BKM + finance check
-- ("satu jalur bayar"), so Max's separate store-payment table is dropped.
--
-- consignmentCycleId: the cycle a bill was born from. NOT unique on purpose: an unlocked cycle keeps
-- its VOIDED receivable (renamed "<noKonsi> (batal)") as history beside the live one. "One live
-- receivable per cycle" is held by `Receivable.invoiceNo @unique` (only the live one carries the bare
-- noKonsi) and by the lock writer's serializable transaction.
-- isConsignment: the ONE konsi marker, stamped at creation and never changed. It drives the Piutang
-- Jenis filter, the holder-only rule on the phone (P31), the BKM journal's AR_CONSIGNMENT credit and
-- the GL exclusions. No konsi decision reads Store.termsType any more.
--
-- Backfill: ONLY sell-through receivables (always konsi). MANUAL/IMPORT rows at KONSI stores are NOT
-- backfilled: until this change the manual and import writers refused KONSI stores, so any such row
-- was a putus invoice when it was made, and prod has none. The dev-bed canary `INV/KONSI/TES` (a
-- hand-seeded MANUAL row at a KONSI store) therefore turns into a visible non-konsi bill: delete it
-- or flip its isConsignment by hand on the dev bed.
--
-- Receivable_one_source_check is re-added with a third source: a DELIVERY-sourced row needs exactly
-- one of deliveryId / sellThroughId / consignmentCycleId; a MANUAL or IMPORT row carries none. Every
-- existing row has consignmentCycleId NULL, so it is judged exactly as before. An older image never
-- writes a cycle receivable, and its delivery writer sets deliveryId, which still passes.
--
-- ConsignmentPayment is dropped: it was created only by 20261031100000_merge_max_features on this
-- unmerged branch, no released image reads it, and no konsi store payment was ever recorded for real.
-- No FOREIGN KEY (relationMode = "prisma"). Every statement is re-runnable.

ALTER TABLE `Receivable` ADD COLUMN IF NOT EXISTS `consignmentCycleId` VARCHAR(191) NULL;

ALTER TABLE `Receivable` ADD COLUMN IF NOT EXISTS `isConsignment` BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS `Receivable_consignmentCycleId_idx` ON `Receivable`(`consignmentCycleId`);

UPDATE `Receivable` SET `isConsignment` = true WHERE `sellThroughId` IS NOT NULL AND `isConsignment` = false;

ALTER TABLE `Receivable` DROP CONSTRAINT IF EXISTS `Receivable_one_source_check`;

ALTER TABLE `Receivable` ADD CONSTRAINT `Receivable_one_source_check` CHECK (
  CASE WHEN `source` = 'DELIVERY'
    THEN ((`deliveryId` IS NOT NULL) + (`sellThroughId` IS NOT NULL) + (`consignmentCycleId` IS NOT NULL)) = 1
    ELSE `deliveryId` IS NULL AND `sellThroughId` IS NULL AND `consignmentCycleId` IS NULL
  END
);

DROP TABLE IF EXISTS `ConsignmentPayment`;
