-- Add per-account theme primary color preference
ALTER TABLE `User`
    ADD COLUMN `themePrimary` VARCHAR(32) NOT NULL DEFAULT '#334155';
