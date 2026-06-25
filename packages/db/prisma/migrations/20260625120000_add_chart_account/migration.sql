CREATE TABLE `ChartAccount` (
  `id` VARCHAR(191) NOT NULL,
  `code` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `type` ENUM('ASET','LIABILITAS','EKUITAS','PENDAPATAN','HPP','BEBAN') NOT NULL,
  `parentId` VARCHAR(191) NULL,
  `depth` INT NOT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `ChartAccount_code_key` (`code`),
  INDEX `ChartAccount_parentId_idx` (`parentId`),
  INDEX `ChartAccount_type_isActive_idx` (`type`, `isActive`),
  INDEX `ChartAccount_code_idx` (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ChartAccount`
  ADD CONSTRAINT `ChartAccount_parentId_fkey`
  FOREIGN KEY (`parentId`) REFERENCES `ChartAccount`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
