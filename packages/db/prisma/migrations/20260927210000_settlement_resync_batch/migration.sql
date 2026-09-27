-- Records the Jubelio resync batch an upload (or the Resync button) started, so a web
-- cron can rematch the settlement once that batch finishes, with no one on the page.
ALTER TABLE `Settlement`
  ADD COLUMN `resyncBatchId` VARCHAR(191) NULL,
  ADD COLUMN `resyncSeededAt` DATETIME(3) NULL,
  ADD COLUMN `resyncRematchedAt` DATETIME(3) NULL;

CREATE INDEX `Settlement_resyncRematchedAt_idx` ON `Settlement`(`resyncRematchedAt`);
