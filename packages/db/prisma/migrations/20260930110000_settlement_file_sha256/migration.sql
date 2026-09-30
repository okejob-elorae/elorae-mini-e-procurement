-- AlterTable Settlement — content hash of the uploaded file. Existing rows stay NULL (no backfill);
-- a unique index allows many NULLs, so only hashed uploads are deduplicated per marketplace.
ALTER TABLE `Settlement` ADD COLUMN `fileSha256` CHAR(64) NULL;

CREATE UNIQUE INDEX `Settlement_marketplace_fileSha256_key` ON `Settlement`(`marketplace`, `fileSha256`);
