-- Per-line count moment: the instant a line's counted figure last changed. Approval re-applies
-- store movements after each line's own moment instead of the document's last save. Nullable:
-- lines saved before this column fall back to StoreStocktake.countFinishedAt. Re-runnable.
ALTER TABLE `StoreStocktakeLine` ADD COLUMN IF NOT EXISTS `countFinishedAt` DATETIME(3) NULL;
