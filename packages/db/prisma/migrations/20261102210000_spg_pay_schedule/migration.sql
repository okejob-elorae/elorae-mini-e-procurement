-- SPG pay by schedule (owner decisions 2026-11-02, P7a-P7e, P8-P11a, P60-P70).
--
-- 1. SpgSaleLine.categoryId / categoryAt / categoryFilledLater: the item category stored on every
--    sale line at sale time, with the moment it was read (P8). Commission reads a piece's category
--    ONLY from its line, never from Item.categoryId. A line sold with no category takes the item's
--    category the first time the item gets one, then freezes (P69, categoryFilledLater = 1).
--    The backfill below stamps existing lines with the item's CURRENT category, dated at the note.
--    No real SPG sale exists yet (owner 2026-11-02), so that is exact for the dev rows.
--    DEPLOY WINDOW: lines the OLD image writes after this migration and before the new web image is
--    live land with categoryAt NULL; the fill-once helper never touches them and they read as
--    unrated. RE-RUN statement 2 (the UPDATE) ONCE after the new web image is live. It is
--    idempotent (WHERE categoryAt IS NULL).
-- 2. SpgCommission.baseSalary / salaryDetail, ConsignmentCommission.salaryDetail: putus SPGs are
--    paid base salary through the system too (P63); the salary snapshot and its day basis.
--    ConsignmentCommission.salaried is NOT dropped: no code reads or writes it from this release on,
--    and it is dropped by a later migration once no deployed image knows it (expand/contract).
-- 3. SpgCommissionCorrection.salaryAmount: the base-salary part of a correction (P64).
-- 4. User.spgStartedOn / spgEndedOn / spgEndedStoreId: the SPG's work window (P62) and the store she
--    left (P66). Dates are WIB 'YYYY-MM-DD'.
-- 5. New tables: SpgMonthSchedule (the monthly schedule header, P7c), SpgSalary (monthly salary per
--    SPG effective from a month, P63), SpgAttendanceRecord + SpgAttendanceRecordDay (the store
--    check-in record the office enters when the SPG did not fill her schedule, P7d/P7e/P61),
--    SpgDebt + SpgDebtSettlement + SpgDebtPayment (what a departed SPG still owes, P6/P6a/P67/P68),
--    SpgExtraPayout (a plus correction paid after her last pay, P67).
--
-- No FOREIGN KEY: relationMode = "prisma". Additive only — new columns are nullable or have a
-- default and nothing is dropped or renamed, so the old image keeps working. Re-runnable
-- (IF NOT EXISTS, and the backfill only touches rows still NULL). No other data backfill: no real
-- konsi order, SPG sale, SPG pay, schedule or check-in record exists (owner 2026-11-02).

ALTER TABLE `SpgSaleLine`
  ADD COLUMN IF NOT EXISTS `categoryId` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `categoryAt` DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS `categoryFilledLater` BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS `SpgSaleLine_itemId_idx` ON `SpgSaleLine`(`itemId`);

UPDATE `SpgSaleLine` l
  JOIN `SpgSale` s ON s.`id` = l.`spgSaleId`
  JOIN `Item` i ON i.`id` = l.`itemId`
  SET l.`categoryId` = i.`categoryId`, l.`categoryAt` = s.`createdAt`
  WHERE l.`categoryAt` IS NULL;

ALTER TABLE `SpgCommission`
  ADD COLUMN IF NOT EXISTS `baseSalary` DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `salaryDetail` JSON NULL;

ALTER TABLE `ConsignmentCommission`
  ADD COLUMN IF NOT EXISTS `salaryDetail` JSON NULL;

ALTER TABLE `SpgCommissionCorrection`
  ADD COLUMN IF NOT EXISTS `salaryAmount` DECIMAL(15,2) NOT NULL DEFAULT 0;

ALTER TABLE `User`
  ADD COLUMN IF NOT EXISTS `spgStartedOn` VARCHAR(10) NULL,
  ADD COLUMN IF NOT EXISTS `spgEndedOn` VARCHAR(10) NULL,
  ADD COLUMN IF NOT EXISTS `spgEndedStoreId` VARCHAR(191) NULL;

CREATE INDEX IF NOT EXISTS `User_spgEndedStoreId_idx` ON `User`(`spgEndedStoreId`);

CREATE TABLE IF NOT EXISTS `SpgMonthSchedule` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `storeId` VARCHAR(191) NOT NULL,
  `month` VARCHAR(7) NOT NULL,
  `status` VARCHAR(10) NOT NULL DEFAULT 'DRAF',
  `version` INTEGER NOT NULL DEFAULT 0,
  `submittedAt` DATETIME(3) NULL,
  `submittedById` VARCHAR(191) NULL,
  `decidedAt` DATETIME(3) NULL,
  `decidedById` VARCHAR(191) NULL,
  `rejectReason` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `SpgMonthSchedule_userId_month_key`(`userId`, `month`),
  INDEX `SpgMonthSchedule_storeId_month_idx`(`storeId`, `month`),
  INDEX `SpgMonthSchedule_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `SpgSalary` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `monthlyAmount` DECIMAL(15,2) NOT NULL,
  `effectiveFrom` VARCHAR(7) NOT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `updatedById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `SpgSalary_userId_effectiveFrom_key`(`userId`, `effectiveFrom`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `SpgAttendanceRecord` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `storeId` VARCHAR(191) NOT NULL,
  `month` VARCHAR(7) NOT NULL,
  `status` VARCHAR(15) NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `source` VARCHAR(10) NOT NULL,
  `fileR2Key` VARCHAR(191) NULL,
  `enteredById` VARCHAR(191) NOT NULL,
  `enteredAt` DATETIME(3) NOT NULL,
  `checkedById` VARCHAR(191) NULL,
  `checkedAt` DATETIME(3) NULL,
  `returnNote` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `SpgAttendanceRecord_userId_month_key`(`userId`, `month`),
  INDEX `SpgAttendanceRecord_status_idx`(`status`),
  INDEX `SpgAttendanceRecord_storeId_month_idx`(`storeId`, `month`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `SpgAttendanceRecordDay` (
  `id` VARCHAR(191) NOT NULL,
  `recordId` VARCHAR(191) NOT NULL,
  `day` VARCHAR(10) NOT NULL,
  `kind` VARCHAR(10) NOT NULL,
  `present` BOOLEAN NOT NULL,
  `note` TEXT NULL,
  UNIQUE INDEX `SpgAttendanceRecordDay_recordId_day_key`(`recordId`, `day`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `SpgDebt` (
  `id` VARCHAR(191) NOT NULL,
  `spgUserId` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(15) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `sourceStoreId` VARCHAR(191) NULL,
  `sourceSalesMonth` VARCHAR(7) NULL,
  `amount` DECIMAL(15,2) NOT NULL,
  `settledAmount` DECIMAL(15,2) NOT NULL DEFAULT 0,
  `status` VARCHAR(10) NOT NULL DEFAULT 'TERBUKA',
  `createdRefType` VARCHAR(40) NOT NULL,
  `createdRefId` VARCHAR(191) NOT NULL,
  `note` TEXT NOT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `settledAt` DATETIME(3) NULL,
  UNIQUE INDEX `SpgDebt_createdRefType_createdRefId_kind_sourceKey_key`(`createdRefType`, `createdRefId`, `kind`, `sourceKey`),
  INDEX `SpgDebt_spgUserId_status_idx`(`spgUserId`, `status`),
  INDEX `SpgDebt_status_createdAt_idx`(`status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `SpgDebtSettlement` (
  `id` VARCHAR(191) NOT NULL,
  `debtId` VARCHAR(191) NOT NULL,
  `amount` DECIMAL(15,2) NOT NULL,
  `kind` VARCHAR(10) NOT NULL,
  `refType` VARCHAR(40) NOT NULL,
  `refId` VARCHAR(191) NOT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `voidedAt` DATETIME(3) NULL,
  `voidedById` VARCHAR(191) NULL,
  UNIQUE INDEX `SpgDebtSettlement_debtId_refType_refId_key`(`debtId`, `refType`, `refId`),
  INDEX `SpgDebtSettlement_refType_refId_idx`(`refType`, `refId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `SpgDebtPayment` (
  `id` VARCHAR(191) NOT NULL,
  `spgUserId` VARCHAR(191) NOT NULL,
  `amount` DECIMAL(15,2) NOT NULL,
  `method` VARCHAR(10) NOT NULL,
  `receivedOn` VARCHAR(10) NOT NULL,
  `photoR2Key` VARCHAR(191) NULL,
  `note` TEXT NULL,
  `status` VARCHAR(15) NOT NULL DEFAULT 'MENUNGGU_CEK',
  `version` INTEGER NOT NULL DEFAULT 1,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `checkedById` VARCHAR(191) NULL,
  `checkedAt` DATETIME(3) NULL,
  `returnNote` TEXT NULL,
  `voidedAt` DATETIME(3) NULL,
  `voidedById` VARCHAR(191) NULL,
  `voidReason` TEXT NULL,
  UNIQUE INDEX `SpgDebtPayment_idempotencyKey_key`(`idempotencyKey`),
  INDEX `SpgDebtPayment_spgUserId_status_idx`(`spgUserId`, `status`),
  INDEX `SpgDebtPayment_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `SpgExtraPayout` (
  `id` VARCHAR(191) NOT NULL,
  `spgUserId` VARCHAR(191) NOT NULL,
  `amount` DECIMAL(15,2) NOT NULL,
  `offsetAmount` DECIMAL(15,2) NOT NULL DEFAULT 0,
  `method` VARCHAR(10) NULL,
  `paidOn` VARCHAR(10) NOT NULL,
  `photoR2Key` VARCHAR(191) NULL,
  `note` TEXT NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `SpgExtraPayout_idempotencyKey_key`(`idempotencyKey`),
  INDEX `SpgExtraPayout_spgUserId_idx`(`spgUserId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
