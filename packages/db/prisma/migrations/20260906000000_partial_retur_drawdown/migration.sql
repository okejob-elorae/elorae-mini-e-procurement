ALTER TABLE `FieldReturn` ADD COLUMN IF NOT EXISTS `appliedValue` DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE `Payment` ADD COLUMN IF NOT EXISTS `fieldReturnId` VARCHAR(191) NULL;
ALTER TABLE `Payment` ADD INDEX IF NOT EXISTS `Payment_fieldReturnId_idx` (`fieldReturnId`);

UPDATE `Payment` p
  JOIN `FieldReturn` fr ON fr.`offsetPaymentId` = p.`id`
  SET p.`fieldReturnId` = fr.`id`;

UPDATE `FieldReturn`
  SET `appliedValue` = COALESCE(`totalValue`, 0)
  WHERE `offsetStatus` = 'APPLIED';

ALTER TABLE `FieldReturn` DROP INDEX `FieldReturn_offsetPaymentId_key`;
ALTER TABLE `FieldReturn` DROP COLUMN `offsetPaymentId`;
