-- Optional Pantone on a material item (#410): ops keep one fabric item per colour.
ALTER TABLE `Item` ADD COLUMN `pantoneTcx` VARCHAR(191) NULL;
CREATE INDEX `Item_pantoneTcx_idx` ON `Item`(`pantoneTcx`);
