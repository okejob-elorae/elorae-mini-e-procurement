-- A variant Jubelio had no figure for is now stored as NULL jubelioQty and variance, and a
-- per-item failure is recorded on its row. Existing rows are NOT backfilled: a stored 0 from
-- before this change cannot be told apart from a real Jubelio zero.
ALTER TABLE `ReconciliationResult`
  MODIFY `jubelioQty` DECIMAL(10,2) NULL,
  MODIFY `variance` DECIMAL(10,2) NULL,
  ADD COLUMN `errorMessage` TEXT NULL;
