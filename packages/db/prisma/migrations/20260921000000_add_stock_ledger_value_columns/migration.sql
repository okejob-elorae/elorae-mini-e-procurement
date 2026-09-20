-- StockLedgerEntry gains value columns (totalCost, balanceValue) matching StockMovement's
-- precision exactly -- these are copied from the same computations at the writer, never
-- re-derived, so they agree with the StockMovement row written beside them by construction.
--
-- Nullable, with no backfill and no data movement. Every row already in the ledger was written
-- before these columns existed, and none of their values can be reconstructed: the moving
-- average at that instant is recorded nowhere else. NULL here means "not recorded", not zero --
-- do not backfill it with 0 or with qty * unitCost, which is the wrong number anyway (unitCost
-- is what that one movement cost, not the running average the balance was valued at). Any reader
-- of these columns must treat NULL as unknown and say so on screen rather than rendering Rp 0.
--
-- This is a second cutover inside the ledger's own history: quantity history began at the
-- previous migration (20260915000000_add_stock_ledger); value history begins here.
ALTER TABLE `StockLedgerEntry` ADD COLUMN `totalCost` DECIMAL(15, 2) NULL;
ALTER TABLE `StockLedgerEntry` ADD COLUMN `balanceValue` DECIMAL(15, 2) NULL;
