-- A whole location's ledger history by time (FOLLOWUPS: store stocktake save locks every STORE row).
CREATE INDEX `StockLedgerEntry_location_time_idx` ON `StockLedgerEntry`(`locationType`, `locationId`, `createdAt`);
