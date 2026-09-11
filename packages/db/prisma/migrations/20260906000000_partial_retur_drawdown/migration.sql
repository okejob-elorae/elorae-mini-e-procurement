ALTER TABLE `FieldReturn` ADD COLUMN IF NOT EXISTS `appliedValue` DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE `Payment` ADD COLUMN IF NOT EXISTS `fieldReturnId` VARCHAR(191) NULL;
ALTER TABLE `Payment` ADD INDEX IF NOT EXISTS `Payment_fieldReturnId_idx` (`fieldReturnId`);

UPDATE `Payment` p
  JOIN `FieldReturn` fr ON fr.`offsetPaymentId` = p.`id`
  SET p.`fieldReturnId` = fr.`id`;

-- Recovers a VOIDED offset payment's link: the old voidPayment nulled offsetPaymentId on void,
-- so the join above never catches it, and this column is the only trail back to its retur.
-- 'returoffset-' is 12 characters, so SUBSTRING(..., 13) is the id. Safe for every consumer,
-- which all filter status: "POSTED" -- these rows are VOIDED. The IN clause guards against any
-- future idempotency key shape that happens to share this prefix.
UPDATE `Payment`
  SET `fieldReturnId` = SUBSTRING(`idempotencyKey`, 13)
  WHERE `fieldReturnId` IS NULL
    AND `idempotencyKey` LIKE 'returoffset-%'
    AND SUBSTRING(`idempotencyKey`, 13) IN (SELECT `id` FROM `FieldReturn`);

UPDATE `FieldReturn`
  SET `appliedValue` = COALESCE(`totalValue`, 0)
  WHERE `offsetStatus` = 'APPLIED';

ALTER TABLE `FieldReturn` DROP INDEX IF EXISTS `FieldReturn_offsetPaymentId_key`;
ALTER TABLE `FieldReturn` DROP COLUMN `offsetPaymentId`;
