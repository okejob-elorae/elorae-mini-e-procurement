-- A sell-through line records the movements it took over from the previous report's period: rows
-- stamped inside that period whose transaction committed only after that report was approved. The
-- late figures are already included in the line's in/out/POS/gap totals; they are also stored on
-- their own, so the next report can re-derive this report's window and compare like with like.
--
-- Existing lines carried nothing, so every default is zero or false. Re-runnable: every column add
-- is IF NOT EXISTS.

ALTER TABLE `KonsiSellThroughLine` ADD COLUMN IF NOT EXISTS `lateInQty` DECIMAL(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE `KonsiSellThroughLine` ADD COLUMN IF NOT EXISTS `lateOutQty` DECIMAL(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE `KonsiSellThroughLine` ADD COLUMN IF NOT EXISTS `latePosSoldQty` DECIMAL(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE `KonsiSellThroughLine` ADD COLUMN IF NOT EXISTS `lateGapQty` DECIMAL(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE `KonsiSellThroughLine` ADD COLUMN IF NOT EXISTS `hasLateMovements` BOOLEAN NOT NULL DEFAULT false;
