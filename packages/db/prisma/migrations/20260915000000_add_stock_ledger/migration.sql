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

-- Opening balances. One row per non-zero balance, quantity carried straight across, so the
-- running balance is correct from the first real movement onward. No history is reconstructed:
-- the existing StockMovement ledger is incomplete for main and replaying it would bake that
-- drift in permanently. Guarded on absence so a partial apply can be re-run safely.
INSERT INTO `StockLedgerEntry`
  (`id`, `locationType`, `locationId`, `itemId`, `variantSku`, `type`, `qty`, `balanceQty`, `refType`, `refId`, `refDocNumber`, `createdAt`)
SELECT
  CONCAT('opn_main_', iv.`id`), 'MAIN', '', iv.`itemId`, COALESCE(iv.`variantSku`, ''),
  'OPENING', iv.`qtyOnHand`, iv.`qtyOnHand`, 'OpeningBalance', iv.`id`, '', NOW(3)
FROM `InventoryValue` iv
WHERE iv.`qtyOnHand` <> 0
  AND NOT EXISTS (
    SELECT 1 FROM `StockLedgerEntry` e
    WHERE e.`type` = 'OPENING' AND e.`locationType` = 'MAIN'
      AND e.`itemId` = iv.`itemId` AND e.`variantSku` = COALESCE(iv.`variantSku`, '')
  );

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

INSERT INTO `StockLedgerEntry`
  (`id`, `locationType`, `locationId`, `itemId`, `variantSku`, `type`, `qty`, `balanceQty`, `refType`, `refId`, `refDocNumber`, `createdAt`)
SELECT
  CONCAT('opn_van_', vs.`id`), 'VAN', vs.`userId`, vs.`itemId`, COALESCE(vs.`variantSku`, ''),
  'OPENING', vs.`qty`, vs.`qty`, 'OpeningBalance', vs.`id`, '', NOW(3)
FROM `VanStock` vs
WHERE vs.`qty` <> 0
  AND NOT EXISTS (
    SELECT 1 FROM `StockLedgerEntry` e
    WHERE e.`type` = 'OPENING' AND e.`locationType` = 'VAN' AND e.`locationId` = vs.`userId`
      AND e.`itemId` = vs.`itemId` AND e.`variantSku` = COALESCE(vs.`variantSku`, '')
  );
