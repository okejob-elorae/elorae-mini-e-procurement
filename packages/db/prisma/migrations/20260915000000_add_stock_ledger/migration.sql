-- Location-aware stock movement ledger. Sits beside InventoryValue / StoreStock / VanStock,
-- which remain the current-state read path. No foreign keys: relationMode = "prisma".
CREATE TABLE IF NOT EXISTS `StockLedgerEntry` (
  `id`           VARCHAR(191) NOT NULL,
  `locationType` ENUM('MAIN', 'STORE', 'VAN') NOT NULL,
  `locationId`   VARCHAR(191) NOT NULL DEFAULT '',
  `itemId`       VARCHAR(191) NOT NULL,
  `variantSku`   VARCHAR(191) NOT NULL DEFAULT '',
  `type`         ENUM('OPENING', 'IN', 'OUT', 'ADJUSTMENT') NOT NULL,
  `qty`          DECIMAL(10, 2) NOT NULL,
  `unitCost`     DECIMAL(15, 2) NULL,
  `balanceQty`   DECIMAL(10, 2) NOT NULL,
  `refType`      VARCHAR(191) NOT NULL,
  `refId`        VARCHAR(191) NOT NULL,
  `refDocNumber` VARCHAR(191) NOT NULL DEFAULT '',
  `createdById`  VARCHAR(191) NULL,
  `createdAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `StockLedgerEntry_location_item_idx` (`locationType`, `locationId`, `itemId`, `variantSku`, `createdAt`),
  INDEX `StockLedgerEntry_itemId_createdAt_idx` (`itemId`, `createdAt`),
  INDEX `StockLedgerEntry_refType_refId_idx` (`refType`, `refId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Opening balances. One row per LEDGER KEY, not per balance row: the ledger stores exactly one
-- spelling of "no variant" (the empty string) while InventoryValue and VanStock legitimately hold
-- both a NULL-spelled and a ""-spelled row for the same item — MySQL does not enforce a @@unique
-- across NULLs, so such pairs exist in the wild. Emitting one OPENING per balance row would put
-- two rows at the identical ledger key (double-counting the opening balance) or drop one of them,
-- and the ledger is append-only, so whichever landed would be permanent. Grouping on the
-- normalised key and summing is the only spelling that agrees with every reader, all of which
-- fold the NULL/"" bucket into one figure (see getStockAcrossLocations).
--
-- Quantity is carried straight across, so the running balance is correct from the first real
-- movement onward. No history is reconstructed: the existing StockMovement ledger is incomplete
-- for main and replaying it would bake that drift in permanently.
--
-- The non-zero test is HAVING SUM(...) <> 0, deliberately, NOT a per-row qtyOnHand <> 0 in WHERE.
-- The opening balance of a ledger key is the SUM over its bucket, so a bucket whose rows are
-- individually non-zero but sum to zero (+5 NULL, -5 "") genuinely has nothing on hand and must
-- get no OPENING row, while a bucket holding a zero row beside a non-zero one must still get one
-- carrying the full sum. Filtering rows out first would answer both of those wrong.
--
-- The NOT EXISTS re-run guard sits in WHERE rather than HAVING on purpose: it depends only on the
-- group-key columns (itemId and the normalised variantSku), so evaluating it per row gives the
-- identical answer for every row of a bucket, and a plain correlated WHERE subquery is the
-- construct the rest of this file already uses.
INSERT INTO `StockLedgerEntry`
  (`id`, `locationType`, `locationId`, `itemId`, `variantSku`, `type`, `qty`, `balanceQty`, `refType`, `refId`, `refDocNumber`, `createdAt`)
SELECT
  CONCAT('opn_main_', MIN(iv.`id`)), 'MAIN', '', iv.`itemId`, COALESCE(iv.`variantSku`, ''),
  'OPENING', SUM(iv.`qtyOnHand`), SUM(iv.`qtyOnHand`), 'OpeningBalance',
  -- refId is REPRESENTATIVE of a possibly-folded bucket, not its sole source: when an item holds
  -- both a NULL-spelled and a ""-spelled row this names only the lower id of the pair, while qty
  -- carries both. Never treat it as "the row this opening came from".
  MIN(iv.`id`), '', NOW(3)
FROM `InventoryValue` iv
WHERE NOT EXISTS (
    SELECT 1 FROM `StockLedgerEntry` e
    WHERE e.`type` = 'OPENING' AND e.`locationType` = 'MAIN'
      AND e.`itemId` = iv.`itemId` AND e.`variantSku` = COALESCE(iv.`variantSku`, '')
  )
GROUP BY iv.`itemId`, COALESCE(iv.`variantSku`, '')
HAVING SUM(iv.`qtyOnHand`) <> 0;

-- StoreStock.variantSku is NOT NULL with a "" default and carries a unique key over
-- (storeId, itemId, variantSku), so exactly one balance row exists per ledger key already and
-- there is no bucket to fold. Left per-row deliberately; the COALESCE is a no-op kept for shape.
INSERT INTO `StockLedgerEntry`
  (`id`, `locationType`, `locationId`, `itemId`, `variantSku`, `type`, `qty`, `balanceQty`, `refType`, `refId`, `refDocNumber`, `createdAt`)
SELECT
  CONCAT('opn_store_', ss.`id`), 'STORE', ss.`storeId`, ss.`itemId`, COALESCE(ss.`variantSku`, ''),
  'OPENING', ss.`qty`, ss.`qty`, 'OpeningBalance', ss.`id`, '', NOW(3)
FROM `StoreStock` ss
WHERE ss.`qty` <> 0
  AND NOT EXISTS (
    SELECT 1 FROM `StockLedgerEntry` e
    WHERE e.`type` = 'OPENING' AND e.`locationType` = 'STORE' AND e.`locationId` = ss.`storeId`
      AND e.`itemId` = ss.`itemId` AND e.`variantSku` = COALESCE(ss.`variantSku`, '')
  );

-- VanStock.variantSku IS nullable (its writers insert "", but NULL is legal), so this has the
-- same dual-bucket exposure as the main insert above and is aggregated on the same terms.
INSERT INTO `StockLedgerEntry`
  (`id`, `locationType`, `locationId`, `itemId`, `variantSku`, `type`, `qty`, `balanceQty`, `refType`, `refId`, `refDocNumber`, `createdAt`)
SELECT
  CONCAT('opn_van_', MIN(vs.`id`)), 'VAN', vs.`userId`, vs.`itemId`, COALESCE(vs.`variantSku`, ''),
  'OPENING', SUM(vs.`qty`), SUM(vs.`qty`), 'OpeningBalance',
  -- Representative of a possibly-folded bucket, exactly as above.
  MIN(vs.`id`), '', NOW(3)
FROM `VanStock` vs
WHERE NOT EXISTS (
    SELECT 1 FROM `StockLedgerEntry` e
    WHERE e.`type` = 'OPENING' AND e.`locationType` = 'VAN' AND e.`locationId` = vs.`userId`
      AND e.`itemId` = vs.`itemId` AND e.`variantSku` = COALESCE(vs.`variantSku`, '')
  )
GROUP BY vs.`userId`, vs.`itemId`, COALESCE(vs.`variantSku`, '')
HAVING SUM(vs.`qty`) <> 0;
