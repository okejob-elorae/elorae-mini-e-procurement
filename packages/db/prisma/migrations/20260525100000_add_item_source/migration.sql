-- AlterTable
ALTER TABLE `Item` ADD COLUMN `source` ENUM('ERP', 'JUBELIO_INGEST') NOT NULL DEFAULT 'ERP';

-- Backfill: rows linked to JubelioProductMapping originated from Jubelio catalog ingest
UPDATE `Item` SET `source` = 'JUBELIO_INGEST'
WHERE `id` IN (SELECT DISTINCT `itemId` FROM `JubelioProductMapping`);
