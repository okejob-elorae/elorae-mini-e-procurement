-- Per-line count moment: the instant a line's counted figure last changed. Approval re-applies
-- store movements after each line's own moment instead of the document's last save. Nullable:
-- lines saved before this column fall back to StoreStocktake.countFinishedAt. Re-runnable.
ALTER TABLE `StoreStocktakeLine` ADD COLUMN IF NOT EXISTS `countFinishedAt` DATETIME(3) NULL;

-- Backfill the counted lines of every still-open count with the document's current stamp. Left
-- null, such a line keeps falling back to the document stamp, which moves on the next save that
-- changes ANY line, so an admin correcting one line would re-date every other line and drop the
-- sales made since it was counted. Approved and cancelled counts are history and stay null.
-- Re-runnable: only lines still null are touched.
UPDATE `StoreStocktakeLine` l
JOIN `StoreStocktake` s ON s.`id` = l.`stocktakeId`
SET l.`countFinishedAt` = s.`countFinishedAt`
WHERE l.`countFinishedAt` IS NULL
  AND l.`countedQty` IS NOT NULL
  AND s.`countFinishedAt` IS NOT NULL
  AND s.`status` IN ('DRAFT', 'PENDING_VERIFICATION');
