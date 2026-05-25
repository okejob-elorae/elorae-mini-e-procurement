-- Pantone-driven account theme: replace preset base with Pantone TCX + seed hex
ALTER TABLE `User` ADD COLUMN `themePantoneTcx` VARCHAR(191) NULL;
ALTER TABLE `User` ADD COLUMN `themePrimaryHex` VARCHAR(191) NOT NULL DEFAULT '#334155';

UPDATE `User` SET `themePrimaryHex` = COALESCE(`themePrimary`, '#334155');

ALTER TABLE `User` DROP COLUMN `themePrimary`;
ALTER TABLE `User` DROP COLUMN `themeBase`;

ALTER TABLE `User` ADD CONSTRAINT `User_themePantoneTcx_fkey` FOREIGN KEY (`themePantoneTcx`) REFERENCES `PantoneColor`(`tcx`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX `User_themePantoneTcx_idx` ON `User`(`themePantoneTcx`);
