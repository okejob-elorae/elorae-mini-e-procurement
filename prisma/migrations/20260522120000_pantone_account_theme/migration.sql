-- Pantone-driven account theme: replace preset base with Pantone TCX + seed hex
ALTER TABLE `user` ADD COLUMN `themePantoneTcx` VARCHAR(191) NULL;
ALTER TABLE `user` ADD COLUMN `themePrimaryHex` VARCHAR(191) NOT NULL DEFAULT '#334155';

UPDATE `user` SET `themePrimaryHex` = COALESCE(`themePrimary`, '#334155');

ALTER TABLE `user` DROP COLUMN `themePrimary`;
ALTER TABLE `user` DROP COLUMN `themeBase`;

ALTER TABLE `user` ADD CONSTRAINT `user_themePantoneTcx_fkey` FOREIGN KEY (`themePantoneTcx`) REFERENCES `PantoneColor`(`tcx`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX `user_themePantoneTcx_idx` ON `user`(`themePantoneTcx`);
