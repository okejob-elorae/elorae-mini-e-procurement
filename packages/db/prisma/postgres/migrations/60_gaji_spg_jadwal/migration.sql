-- Gaji SPG menurut jadwal (keputusan pemilik 2026-11-02, P7a-P7e, P8-P11a, P60-P70). Kembaran
-- PostgreSQL dari migrasi MariaDB `20261102210000_spg_pay_schedule`; penjelasan lengkap ada di sana.
--
-- 1. SpgSaleLine.categoryId / categoryAt / categoryFilledLater: kategori barang disimpan di setiap
--    baris penjualan saat terjual, beserta waktunya (P8); baris tanpa kategori mengikuti kategori
--    yang diisi belakangan, sekali (P69). Isian ulang di bawah memberi baris lama kategori barang
--    SEKARANG bertanggal nota (belum ada penjualan SPG sungguhan). Jalankan ulang UPDATE itu sekali
--    sesudah image web baru hidup — baris yang ditulis image lama di sela itu masih NULL.
-- 2. SpgCommission.baseSalary / salaryDetail, ConsignmentCommission.salaryDetail (P63). Kolom
--    `salaried` TIDAK dihapus (expand/contract; dihapus migrasi berikutnya).
-- 3. SpgCommissionCorrection.salaryAmount (P64).
-- 4. User.spgStartedOn / spgEndedOn / spgEndedStoreId (P62, P66).
-- 5. Tabel baru: SpgMonthSchedule, SpgSalary, SpgAttendanceRecord(+Day), SpgDebt(+Settlement,
--    +Payment), SpgExtraPayout.
--
-- Tanpa FOREIGN KEY (relationMode = "prisma"). Hanya menambah; boleh dijalankan ulang.

ALTER TABLE "SpgSaleLine" ADD COLUMN IF NOT EXISTS "categoryId" TEXT;
ALTER TABLE "SpgSaleLine" ADD COLUMN IF NOT EXISTS "categoryAt" TIMESTAMP(3);
ALTER TABLE "SpgSaleLine" ADD COLUMN IF NOT EXISTS "categoryFilledLater" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "SpgSaleLine_itemId_idx" ON "SpgSaleLine"("itemId");

UPDATE "SpgSaleLine" l
  SET "categoryId" = i."categoryId", "categoryAt" = s."createdAt"
  FROM "SpgSale" s, "Item" i
  WHERE s."id" = l."spgSaleId" AND i."id" = l."itemId" AND l."categoryAt" IS NULL;

ALTER TABLE "SpgCommission" ADD COLUMN IF NOT EXISTS "baseSalary" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "SpgCommission" ADD COLUMN IF NOT EXISTS "salaryDetail" JSONB;
ALTER TABLE "ConsignmentCommission" ADD COLUMN IF NOT EXISTS "salaryDetail" JSONB;
ALTER TABLE "SpgCommissionCorrection" ADD COLUMN IF NOT EXISTS "salaryAmount" DECIMAL(15,2) NOT NULL DEFAULT 0;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "spgStartedOn" VARCHAR(10);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "spgEndedOn" VARCHAR(10);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "spgEndedStoreId" TEXT;
CREATE INDEX IF NOT EXISTS "User_spgEndedStoreId_idx" ON "User"("spgEndedStoreId");

CREATE TABLE IF NOT EXISTS "SpgMonthSchedule" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "month" VARCHAR(7) NOT NULL,
  "status" VARCHAR(10) NOT NULL DEFAULT 'DRAF',
  "version" INTEGER NOT NULL DEFAULT 0,
  "submittedAt" TIMESTAMP(3),
  "submittedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decidedById" TEXT,
  "rejectReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SpgMonthSchedule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SpgMonthSchedule_userId_month_key" ON "SpgMonthSchedule"("userId", "month");
CREATE INDEX IF NOT EXISTS "SpgMonthSchedule_storeId_month_idx" ON "SpgMonthSchedule"("storeId", "month");
CREATE INDEX IF NOT EXISTS "SpgMonthSchedule_status_idx" ON "SpgMonthSchedule"("status");

CREATE TABLE IF NOT EXISTS "SpgSalary" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "monthlyAmount" DECIMAL(15,2) NOT NULL,
  "effectiveFrom" VARCHAR(7) NOT NULL,
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SpgSalary_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SpgSalary_userId_effectiveFrom_key" ON "SpgSalary"("userId", "effectiveFrom");

CREATE TABLE IF NOT EXISTS "SpgAttendanceRecord" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "month" VARCHAR(7) NOT NULL,
  "status" VARCHAR(15) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "source" VARCHAR(10) NOT NULL,
  "fileR2Key" VARCHAR(191),
  "enteredById" TEXT NOT NULL,
  "enteredAt" TIMESTAMP(3) NOT NULL,
  "checkedById" TEXT,
  "checkedAt" TIMESTAMP(3),
  "returnNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SpgAttendanceRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SpgAttendanceRecord_userId_month_key" ON "SpgAttendanceRecord"("userId", "month");
CREATE INDEX IF NOT EXISTS "SpgAttendanceRecord_status_idx" ON "SpgAttendanceRecord"("status");
CREATE INDEX IF NOT EXISTS "SpgAttendanceRecord_storeId_month_idx" ON "SpgAttendanceRecord"("storeId", "month");

CREATE TABLE IF NOT EXISTS "SpgAttendanceRecordDay" (
  "id" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "day" VARCHAR(10) NOT NULL,
  "kind" VARCHAR(10) NOT NULL,
  "present" BOOLEAN NOT NULL,
  "note" TEXT,
  CONSTRAINT "SpgAttendanceRecordDay_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SpgAttendanceRecordDay_recordId_day_key" ON "SpgAttendanceRecordDay"("recordId", "day");

CREATE TABLE IF NOT EXISTS "SpgDebt" (
  "id" TEXT NOT NULL,
  "spgUserId" TEXT NOT NULL,
  "kind" VARCHAR(15) NOT NULL,
  "sourceKey" VARCHAR(191) NOT NULL,
  "sourceStoreId" TEXT,
  "sourceSalesMonth" VARCHAR(7),
  "amount" DECIMAL(15,2) NOT NULL,
  "settledAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "status" VARCHAR(10) NOT NULL DEFAULT 'TERBUKA',
  "createdRefType" VARCHAR(40) NOT NULL,
  "createdRefId" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settledAt" TIMESTAMP(3),
  CONSTRAINT "SpgDebt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SpgDebt_createdRefType_createdRefId_kind_sourceKey_key" ON "SpgDebt"("createdRefType", "createdRefId", "kind", "sourceKey");
CREATE INDEX IF NOT EXISTS "SpgDebt_spgUserId_status_idx" ON "SpgDebt"("spgUserId", "status");
CREATE INDEX IF NOT EXISTS "SpgDebt_status_createdAt_idx" ON "SpgDebt"("status", "createdAt");

CREATE TABLE IF NOT EXISTS "SpgDebtSettlement" (
  "id" TEXT NOT NULL,
  "debtId" TEXT NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "kind" VARCHAR(10) NOT NULL,
  "refType" VARCHAR(40) NOT NULL,
  "refId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voidedAt" TIMESTAMP(3),
  "voidedById" TEXT,
  CONSTRAINT "SpgDebtSettlement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SpgDebtSettlement_debtId_refType_refId_key" ON "SpgDebtSettlement"("debtId", "refType", "refId");
CREATE INDEX IF NOT EXISTS "SpgDebtSettlement_refType_refId_idx" ON "SpgDebtSettlement"("refType", "refId");

CREATE TABLE IF NOT EXISTS "SpgDebtPayment" (
  "id" TEXT NOT NULL,
  "spgUserId" TEXT NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "method" VARCHAR(10) NOT NULL,
  "receivedOn" VARCHAR(10) NOT NULL,
  "photoR2Key" TEXT,
  "note" TEXT,
  "status" VARCHAR(15) NOT NULL DEFAULT 'MENUNGGU_CEK',
  "version" INTEGER NOT NULL DEFAULT 1,
  "idempotencyKey" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "checkedById" TEXT,
  "checkedAt" TIMESTAMP(3),
  "returnNote" TEXT,
  "voidedAt" TIMESTAMP(3),
  "voidedById" TEXT,
  "voidReason" TEXT,
  CONSTRAINT "SpgDebtPayment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SpgDebtPayment_idempotencyKey_key" ON "SpgDebtPayment"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "SpgDebtPayment_spgUserId_status_idx" ON "SpgDebtPayment"("spgUserId", "status");
CREATE INDEX IF NOT EXISTS "SpgDebtPayment_status_idx" ON "SpgDebtPayment"("status");

CREATE TABLE IF NOT EXISTS "SpgExtraPayout" (
  "id" TEXT NOT NULL,
  "spgUserId" TEXT NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "offsetAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "method" VARCHAR(10),
  "paidOn" VARCHAR(10) NOT NULL,
  "photoR2Key" TEXT,
  "note" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpgExtraPayout_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SpgExtraPayout_idempotencyKey_key" ON "SpgExtraPayout"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "SpgExtraPayout_spgUserId_idx" ON "SpgExtraPayout"("spgUserId");
