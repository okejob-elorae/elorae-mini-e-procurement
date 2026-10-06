-- Records, per approved sell-through line, the surplus units no COGS or shrinkage relieved, so the
-- surplus journal can value them at the line's unit cost. Defaults to 0: a report approved before
-- this column existed owes no surplus journal. Re-runnable.
ALTER TABLE `KonsiSellThroughLine` ADD COLUMN IF NOT EXISTS `surplusQty` DECIMAL(10,2) NOT NULL DEFAULT 0;
