-- Admin store return: an admin raises the same warehouse movement a salesman raises with
-- FieldReturn, but from the office, with neither a nota photo in hand nor a transport mode to
-- record at the moment of raising it. `origin` distinguishes FIELD (existing rows, the default)
-- from ADMIN so the writer can enforce the nota-photo/transport requirement per origin in
-- Task 2 rather than at the database. This does NOT relax the FIELD rule: a FIELD return still
-- requires both, enforced in the writer, not here.
--
-- Re-runnable: a migration recorded as failed blocks every later deploy until
-- `prisma migrate resolve --rolled-back 20260825170000_add_field_return_origin`, and idempotent
-- SQL is what makes re-running that recovery safe. No FOREIGN KEY: relationMode = "prisma".
-- Additive, no backfill: `origin` defaults every existing row to FIELD, which is correct for
-- all of them.

ALTER TABLE `FieldReturn` ADD COLUMN IF NOT EXISTS `origin` ENUM('FIELD', 'ADMIN') NOT NULL DEFAULT 'FIELD';

ALTER TABLE `FieldReturn` MODIFY COLUMN `notaPhotoUrl` VARCHAR(191) NULL;
ALTER TABLE `FieldReturn` MODIFY COLUMN `notaPhotoR2Key` VARCHAR(191) NULL;
ALTER TABLE `FieldReturn` MODIFY COLUMN `transport` ENUM('SELF_CARRY', 'EXPEDITION') NULL;
