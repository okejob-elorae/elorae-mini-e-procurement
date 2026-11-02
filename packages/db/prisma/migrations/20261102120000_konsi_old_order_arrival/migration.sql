-- Old konsi orders whose stock reservation is still held (owner decision 9, 2026-11-01).
--
-- A konsi order approved before the per-shipment konsi flow reached production (PR #318, merged
-- 2026-09-23T16:50:47Z) under the earliest rule only RESERVED its stock at approve. The
-- 2026-09-23 backfill (`20260923000000_konsi_transfer_at_shipment_completion`) left those lines
-- untouched, still RESERVED. Physically the goods usually went to the store long ago; the system
-- still counts them in the main warehouse (reserved) and not at the store.
--
-- Those orders now settle without a delivery shipment: the store's SPG (or, for a store without
-- one, the store's holding salesman during a visit) counts what actually arrived and confirms it,
-- which writes one KonsiTransfer per confirmation through the same writer a completed shipment
-- uses (`issueKonsiTransfer`). The office can only close the remainder as "tidak jadi dikirim".
--
-- KonsiTransfer.oldOrderArrival — true for a transfer written by that confirmation. Such a
--   transfer has no shipment (shipmentId NULL), exactly like a transfer an approve wrote under the
--   later approve-time rule, so this column is what tells the two apart. Every existing row is an
--   approve-time or a shipment transfer, so the default false is right for all of them.
-- KonsiTransferLine.mainCountedByOpnameId — the APPROVED main-warehouse StockOpname that counted
--   the line's item AFTER the order was approved. Its count already left these pcs out, so the
--   confirmation added them to the store and released the reservation without cutting main
--   qtyOnHand a second time, and the consignment move journal credits the opname variance account
--   instead of warehouse inventory. NULL = main stock was cut at this transfer (every existing row).
--   No foreign key: relationMode = "prisma".
--
-- SystemSetting `konsi.pesananLamaSebelum` — the cutoff an order must be approved BEFORE to count
--   as an old order; the code falls back to the same instant when the row is absent or unreadable
--   (`BAWAAN_PESANAN_LAMA_SEBELUM` in apps/web/lib/field-sales/konsi-transfer/pesanan-lama-aturan.ts).
--
-- Additive and re-runnable (IF NOT EXISTS / NOT EXISTS), so a failed-and-resolved migration can be
-- applied again safely.

ALTER TABLE `KonsiTransfer` ADD COLUMN IF NOT EXISTS `oldOrderArrival` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `KonsiTransferLine` ADD COLUMN IF NOT EXISTS `mainCountedByOpnameId` VARCHAR(191) NULL;

INSERT INTO `SystemSetting` (`id`, `key`, `value`, `updatedAt`)
SELECT 'konsi-pesanan-lama-sebelum', 'konsi.pesananLamaSebelum', '2026-09-23T16:50:47.000Z', NOW(3)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `SystemSetting` WHERE `key` = 'konsi.pesananLamaSebelum');
