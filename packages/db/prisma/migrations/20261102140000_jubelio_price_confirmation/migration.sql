-- Jubelio price confirmation (owner decision 2026-11-02): the ERP is the price master, and a
-- selling price reaches Jubelio only after it is confirmed IN THE ERP, on Jubelio -> Konfirmasi
-- harga (permission jubelio_prices:confirm, admin only by default, grantable in Peran & izin).
-- Nothing coming from Jubelio ever changes an existing item's sellingPrice.
--
-- Five nullable Item columns, no index, no FOREIGN KEY (relationMode = prisma; the two ById
-- columns are plain user ids):
--   jubelioConfirmedPrice / jubelioConfirmedAt / jubelioConfirmedById: the last price confirmed for
--     Jubelio, when and by whom. Every ERP -> Jubelio product payload sends this price, never the
--     raw sellingPrice; with none (or 0) the push is skipped as price_not_confirmed. ById NULL with
--     a price means the price was recorded from Jubelio (this backfill, a product created by the
--     catalog ingest, or an existing item the ingest mapped), not confirmed by a person.
--   jubelioCreateRequestedAt / jubelioCreateRequestedById: a request to create this ERP product in
--     Jubelio, waiting for its price to be confirmed. Creating a product is a request now (item
--     form, ticked item import, Ajukan ke Jubelio, bulk migration); confirming it creates it.
-- What waits for confirmation is DERIVED, never stored (apps/web/lib/jubelio/harga): a mapped
-- finished good whose sellingPrice differs from jubelioConfirmedPrice (a price of 0 or less counts
-- as no price on both sides), or an unmapped ERP finished good carrying the request marker. So a
-- price edited twice is one entry, and a price set back to the confirmed one leaves the list by
-- itself. Superseded confirmations live only in AuditLog (JUBELIO_PRICE_CONFIRMED, _REVERTED,
-- JUBELIO_CREATE_REQUEST_CANCELLED).
--
-- Re-runnable: the deploy pipes this file into the mariadb CLI, which stops at the first error
-- with the statements above it applied and the file not recorded, so a second run must be
-- harmless (ADD COLUMN IF NOT EXISTS, and the backfill below is guarded).

ALTER TABLE `Item`
  ADD COLUMN IF NOT EXISTS `jubelioConfirmedPrice` DECIMAL(14, 2) NULL,
  ADD COLUMN IF NOT EXISTS `jubelioConfirmedAt` DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS `jubelioConfirmedById` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `jubelioCreateRequestedAt` DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS `jubelioCreateRequestedById` VARCHAR(191) NULL;

-- Backfill: what an item already in Jubelio (a JubelioProductMapping row) shows there today is the
-- price the ERP last pushed, i.e. its current sellingPrice. Record it as confirmed, so nothing
-- existing becomes pending on day one and nothing ever pushes 0 or NULL. A mapped item with no
-- price, or a price of 0, stays unconfirmed: the new handler skips its pushes instead of sending
-- sell_price 0 as before, and the next product webhook records the price Jubelio holds for it
-- (recordJubelioPriceOnMapping). Unmapped items get nothing. jubelioConfirmedById stays NULL
-- (initial price). Guarded on both confirmation columns being NULL, so a re-run after a partial
-- failure is a no-op.
--
-- Do NOT re-run this statement by hand later: an ERP item the ingest maps afterwards carries a
-- typed price Jubelio never received, and that price must go through confirmation.
--
-- Deploy window (the migrate job runs before the new images go up): the old api keeps pushing the
-- raw sellingPrice. Harmless, because right after this backfill every mapped item has
-- confirmed = sellingPrice. A price edited in that window does reach Jubelio raw; the item then
-- shows as pending (old confirmed price -> new price) although Jubelio already has the new one,
-- and confirming it re-sends the same price. A product the old api creates in the window is mapped
-- with no confirmed price; its next product webhook records Jubelio's price, and until then it
-- shows as pending (no Jubelio price -> its price), where confirming re-sends that price.
-- No request backfill: an unmapped ERP finished good still carrying a PENDING/PROCESSING
-- product_push at deploy is stamped by the new api handler itself (markJubelioCreateRequested) when
-- it processes that row, so it lands on the confirmation list instead of being created.
UPDATE `Item` i
SET i.`jubelioConfirmedPrice` = i.`sellingPrice`,
    i.`jubelioConfirmedAt` = UTC_TIMESTAMP(3)
WHERE i.`jubelioConfirmedAt` IS NULL
  AND i.`jubelioConfirmedPrice` IS NULL
  AND i.`sellingPrice` > 0
  AND EXISTS (SELECT 1 FROM `JubelioProductMapping` m WHERE m.`itemId` = i.`id`);
