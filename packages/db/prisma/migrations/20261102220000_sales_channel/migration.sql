-- Sales channel per finished good and one price recommendation rule (owner answers 2026-11-02,
-- P1-P4a and P71-P76, docs/superpowers/specs/2026-11-02-pertanyaan-lanjutan.md).
--
-- Item.salesChannel (MARKETPLACE | OFFLINE | BOTH): where a finished good is sold, chosen with two
--   ticks on the item form and in the item import by holders of items:create / items:edit (P3,
--   P76). Only MARKETPLACE and BOTH are requested for / pushed to Jubelio; OFFLINE is never sent
--   (P3a), except that a product ALREADY in Jubelio switched to OFFLINE is DEACTIVATED there with
--   one product push (P72, is_active false; nothing is deleted). MARKETPLACE is hidden from every
--   offline picker; documents that already hold it are honoured (P73).
-- Item.priceRuleBasis (MARKUP | MARGIN): the basis of the one recommendation percent stored in
--   targetMarginPercent (P4, P4a). JubelioPushDefaults.defaultPriceRuleBasis is the basis of the
--   default percent; the pair is used whole.
-- Item.jubelioObservedPriceMax / Min / At / ChangedAt: what Jubelio was last READ to show - the
--   highest variant price (P1) and the lowest - written only through
--   @elorae/db recordJubelioObservedPrice (catalog ingest, the api price observer, a successful
--   product push) and createItemFromIngest. Never written by hand, never copied into sellingPrice.
-- Item.jubelioPriceDecidedAt: when an admin last decided the price Jubelio must show (confirm,
--   revert, "Kirim ulang harga ERP"). A Jubelio price that differs from the confirmed one with no
--   decision taken after it is the derived warning "Harga di Jubelio berbeda dengan ERP" (P2), and
--   while it is open no push may change the Jubelio price (P75): the product push is held as
--   price_differs_held.
--
-- The column DEFAULTS are the backfill; there is no UPDATE:
--   salesChannel = BOTH keeps every existing finished good in the offline catalogs with its Jubelio
--     request and mappings untouched, and is also what the catalog ingest gives a new item (P71);
--   priceRuleBasis = MARKUP keeps every stored percent on the formula it was always computed with;
--   the observed columns stay NULL until the first read after deploy, so no false warning and no
--     held push exist on day one (the values live in Jubelio and cannot be filled from SQL);
--   jubelioPriceDecidedAt stays NULL.
--
-- Deploy window (the migrate job runs before the new images): the old web and api never name these
-- columns, so their inserts land BOTH / MARKUP; the old api writes no observation, so no warning or
-- hold appears until the new api runs; no OFFLINE item exists until the new web saves one.
--
-- No index (low cardinality; catalogs already filter on type, isActive), no FOREIGN KEY
-- (relationMode = prisma), no seed. Re-runnable: the deploy pipes this file into the mariadb CLI,
-- which stops at the first error, so every statement is ADD COLUMN IF NOT EXISTS.

ALTER TABLE `Item`
  ADD COLUMN IF NOT EXISTS `salesChannel` ENUM('MARKETPLACE', 'OFFLINE', 'BOTH') NOT NULL DEFAULT 'BOTH',
  ADD COLUMN IF NOT EXISTS `priceRuleBasis` ENUM('MARKUP', 'MARGIN') NOT NULL DEFAULT 'MARKUP',
  ADD COLUMN IF NOT EXISTS `jubelioObservedPriceMax` DECIMAL(14, 2) NULL,
  ADD COLUMN IF NOT EXISTS `jubelioObservedPriceMin` DECIMAL(14, 2) NULL,
  ADD COLUMN IF NOT EXISTS `jubelioObservedAt` DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS `jubelioObservedChangedAt` DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS `jubelioPriceDecidedAt` DATETIME(3) NULL;

ALTER TABLE `JubelioPushDefaults`
  ADD COLUMN IF NOT EXISTS `defaultPriceRuleBasis` ENUM('MARKUP', 'MARGIN') NOT NULL DEFAULT 'MARKUP';
