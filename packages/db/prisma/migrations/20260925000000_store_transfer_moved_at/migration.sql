-- A store-to-store transfer records the moment its goods physically moved. Stock still moves at
-- approve; the move moment is what the transfer, stocktake and sell-through guards compare against
-- a count moment, the way returns key on their raise time.
--
-- Existing transfers take their approval time, or their creation time while still pending. An
-- approved transfer's goods are taken to have moved when it was approved, which is how stocktake
-- approval already treated it. A transfer still PENDING at deploy is therefore dated to its
-- creation, so an approved count at either store that counted its items since then refuses its
-- approval (COUNTED_SINCE_MOVE): cancel it and raise it again with the real move time.
--
-- Re-runnable: the column add is IF NOT EXISTS, the backfill only touches NULL rows, and the
-- MODIFY is idempotent.

ALTER TABLE `StoreTransfer` ADD COLUMN IF NOT EXISTS `movedAt` DATETIME(3) NULL;

UPDATE `StoreTransfer` SET `movedAt` = COALESCE(`approvedAt`, `createdAt`) WHERE `movedAt` IS NULL;

ALTER TABLE `StoreTransfer` MODIFY `movedAt` DATETIME(3) NOT NULL;
