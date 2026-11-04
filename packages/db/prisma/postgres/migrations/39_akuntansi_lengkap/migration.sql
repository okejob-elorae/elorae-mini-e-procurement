-- Akuntansi & pajak lengkap — fondasi (2026-10-08). Rancangan:
-- docs/superpowers/specs/2026-10-08-akuntansi-pajak-lengkap-design.md.
--
-- * Journal: status (POSTED bawaan; DRAFT = jurnal manual menunggu persetujuan
--   orang lain), approvedById/At, rejectedById/At/rejectReason, reversalOfId
--   (UNIK: satu jurnal hanya punya satu jurnal pembalik), originalDate (tanggal
--   asli jurnal otomatis yang digeser keluar dari periode tertutup). Baris lama
--   terbaca POSTED lewat DEFAULT.
-- * JournalLine: dimensi channel (kanal, lib/finance/journals/kanal.ts) dan
--   storeId, keduanya berindeks.
-- * Tabel baru: AccountingPeriod (bulan buku, tidak ada baris = TERBUKA),
--   AccountingYear (penanda tutup tahun), FixedAsset + FixedAssetDepreciation
--   (satu baris per aset per bulan), RecurringJournal + baris, CashCategory
--   (kategori kas -> akun), CashVoucher + baris (BKK/BKM kantor/transfer),
--   BankStatementImport + BankStatementLine (mutasi rekening; satu baris jurnal
--   hanya dicocokkan sekali), SupplierPayment + alokasi, Budget, TaxPayment,
--   TaxPeriodRecap, OpeningBalanceImport.
-- * Supplier.taxWithholding: null (tidak dipotong) | PPH23 (jasa maklon badan,
--   2% bruto, 2x tanpa NPWP) | PPH21 (penjahit orang pribadi, bukan pegawai:
--   50% bruto x tarif Pasal 17) | PPH4_2 (sewa, 10% final) — rumusnya di
--   apps/web lib/finance/pajak/pemotongan.ts; + hasNpwp + npwpEnc/npwpLast4
--   (NPWP/NIK untuk bukti potong, terenkripsi seperti bankAccountEnc). FGReceipt.serviceCost
--   + additionalCost (rincian biaya jasa CMT dan biaya tambahan HPP);
--   GRN.ppnAmount (PPN masukan tersimpan; null = belum dihitung);
--   DeductionType.postingRole (peran akun potongan BKM, mis. PPH23_PREPAID);
--   ExpenseClaim.paidAccountId (akun kas/bank pembayar).
-- * DocType: CASHOUT, CASHIN, CASHTRF, SUPPAY, ASSET. ALTER TYPE ... ADD VALUE
--   boleh di dalam transaksi sejak PostgreSQL 12 selama nilainya belum dipakai
--   di transaksi yang sama.
-- Tanpa foreign key (relationMode = prisma). Tanpa isi awal.

-- AlterEnum
ALTER TYPE "DocType" ADD VALUE 'CASHOUT';
ALTER TYPE "DocType" ADD VALUE 'CASHIN';
ALTER TYPE "DocType" ADD VALUE 'CASHTRF';
ALTER TYPE "DocType" ADD VALUE 'SUPPAY';
ALTER TYPE "DocType" ADD VALUE 'ASSET';

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "hasNpwp" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "npwpEnc" TEXT,
ADD COLUMN     "npwpLast4" TEXT,
ADD COLUMN     "taxWithholding" TEXT;

-- AlterTable
ALTER TABLE "GRN" ADD COLUMN     "ppnAmount" DECIMAL(15,2);

-- AlterTable
ALTER TABLE "FGReceipt" ADD COLUMN     "additionalCost" DECIMAL(15,2),
ADD COLUMN     "serviceCost" DECIMAL(15,2);

-- AlterTable
ALTER TABLE "Journal" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "originalDate" TIMESTAMP(3),
ADD COLUMN     "rejectReason" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedById" TEXT,
ADD COLUMN     "reversalOfId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'POSTED';

-- AlterTable
ALTER TABLE "JournalLine" ADD COLUMN     "channel" TEXT,
ADD COLUMN     "storeId" TEXT;

-- AlterTable
ALTER TABLE "DeductionType" ADD COLUMN     "postingRole" TEXT;

-- AlterTable
ALTER TABLE "ExpenseClaim" ADD COLUMN     "paidAccountId" TEXT;

-- CreateTable
CREATE TABLE "AccountingPeriod" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closeNote" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedById" TEXT,
    "reopenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingYear" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closingJournalId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedById" TEXT,
    "reopenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedAsset" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "acquisitionDate" TIMESTAMP(3) NOT NULL,
    "cost" DECIMAL(18,2) NOT NULL,
    "residualValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "usefulLifeMonths" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'STRAIGHT_LINE',
    "decliningRatePercent" DECIMAL(5,2),
    "depreciationStartDate" TIMESTAMP(3) NOT NULL,
    "accumulatedAtStart" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "assetAccountId" TEXT,
    "accumDepreciationAccountId" TEXT,
    "depreciationExpenseAccountId" TEXT,
    "supplierId" TEXT,
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "disposedAt" TIMESTAMP(3),
    "disposalProceeds" DECIMAL(18,2),
    "disposalNote" TEXT,
    "disposedById" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedAssetDepreciation" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "journalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FixedAssetDepreciation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringJournal" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "frequency" TEXT NOT NULL DEFAULT 'MONTHLY',
    "dayOfMonth" INTEGER NOT NULL DEFAULT 1,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "autoReverse" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunPeriod" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringJournal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringJournalLine" (
    "id" TEXT NOT NULL,
    "recurringJournalId" TEXT NOT NULL,
    "chartAccountId" TEXT NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "memo" TEXT,
    "channel" TEXT,
    "storeId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RecurringJournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'OUT',
    "chartAccountId" TEXT NOT NULL,
    "withholdingType" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashVoucher" (
    "id" TEXT NOT NULL,
    "docNumber" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "cashAccountId" TEXT NOT NULL,
    "transferAccountId" TEXT,
    "counterpart" TEXT,
    "supplierId" TEXT,
    "description" TEXT,
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "withholdingType" TEXT,
    "withholdingAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "photoUrl" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashVoucherLine" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "categoryId" TEXT,
    "chartAccountId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "memo" TEXT,
    "channel" TEXT,
    "storeId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CashVoucherLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementImport" (
    "id" TEXT NOT NULL,
    "chartAccountId" TEXT NOT NULL,
    "bankFormat" TEXT,
    "fileName" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),
    "openingBalance" DECIMAL(18,2),
    "closingBalance" DECIMAL(18,2),
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "importedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatementImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementLine" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "chartAccountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "balance" DECIMAL(18,2),
    "externalRef" TEXT,
    "fingerprint" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "matchedJournalLineId" TEXT,
    "matchedAt" TIMESTAMP(3),
    "matchedById" TEXT,
    "createdJournalId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL,
    "docNumber" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'TRANSFER',
    "cashAccountId" TEXT,
    "reference" TEXT,
    "giroDueDate" TIMESTAMP(3),
    "grossAmount" DECIMAL(18,2) NOT NULL,
    "withholdingType" TEXT,
    "withholdingAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(18,2) NOT NULL,
    "isAdvance" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "note" TEXT,
    "proofPhotoUrl" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "chartAccountId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxPayment" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "ntpn" TEXT,
    "billingCode" TEXT,
    "cashAccountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "note" TEXT,
    "proofPhotoUrl" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxPeriodRecap" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "outputDpp" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "outputTax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "inputDpp" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "inputTax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "compensation" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "finalizedAt" TIMESTAMP(3),
    "finalizedById" TEXT,
    "journalId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxPeriodRecap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningBalanceImport" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "cutoverDate" TIMESTAMP(3) NOT NULL,
    "fileName" TEXT,
    "entries" JSONB NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "journalId" TEXT,
    "postedAt" TIMESTAMP(3),
    "postedById" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpeningBalanceImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountingPeriod_status_idx" ON "AccountingPeriod"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingPeriod_year_month_key" ON "AccountingPeriod"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingYear_year_key" ON "AccountingYear"("year");

-- CreateIndex
CREATE INDEX "AccountingYear_status_idx" ON "AccountingYear"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FixedAsset_code_key" ON "FixedAsset"("code");

-- CreateIndex
CREATE INDEX "FixedAsset_status_idx" ON "FixedAsset"("status");

-- CreateIndex
CREATE INDEX "FixedAsset_category_idx" ON "FixedAsset"("category");

-- CreateIndex
CREATE INDEX "FixedAsset_acquisitionDate_idx" ON "FixedAsset"("acquisitionDate");

-- CreateIndex
CREATE INDEX "FixedAssetDepreciation_period_idx" ON "FixedAssetDepreciation"("period");

-- CreateIndex
CREATE UNIQUE INDEX "FixedAssetDepreciation_assetId_period_key" ON "FixedAssetDepreciation"("assetId", "period");

-- CreateIndex
CREATE INDEX "RecurringJournal_active_idx" ON "RecurringJournal"("active");

-- CreateIndex
CREATE INDEX "RecurringJournalLine_recurringJournalId_idx" ON "RecurringJournalLine"("recurringJournalId");

-- CreateIndex
CREATE INDEX "RecurringJournalLine_chartAccountId_idx" ON "RecurringJournalLine"("chartAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "CashCategory_name_key" ON "CashCategory"("name");

-- CreateIndex
CREATE INDEX "CashCategory_type_isActive_idx" ON "CashCategory"("type", "isActive");

-- CreateIndex
CREATE INDEX "CashCategory_chartAccountId_idx" ON "CashCategory"("chartAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "CashVoucher_docNumber_key" ON "CashVoucher"("docNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CashVoucher_idempotencyKey_key" ON "CashVoucher"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CashVoucher_type_date_idx" ON "CashVoucher"("type", "date");

-- CreateIndex
CREATE INDEX "CashVoucher_cashAccountId_date_idx" ON "CashVoucher"("cashAccountId", "date");

-- CreateIndex
CREATE INDEX "CashVoucher_status_idx" ON "CashVoucher"("status");

-- CreateIndex
CREATE INDEX "CashVoucher_supplierId_idx" ON "CashVoucher"("supplierId");

-- CreateIndex
CREATE INDEX "CashVoucherLine_voucherId_idx" ON "CashVoucherLine"("voucherId");

-- CreateIndex
CREATE INDEX "CashVoucherLine_chartAccountId_idx" ON "CashVoucherLine"("chartAccountId");

-- CreateIndex
CREATE INDEX "BankStatementImport_chartAccountId_periodFrom_idx" ON "BankStatementImport"("chartAccountId", "periodFrom");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementLine_matchedJournalLineId_key" ON "BankStatementLine"("matchedJournalLineId");

-- CreateIndex
CREATE INDEX "BankStatementLine_importId_idx" ON "BankStatementLine"("importId");

-- CreateIndex
CREATE INDEX "BankStatementLine_chartAccountId_date_idx" ON "BankStatementLine"("chartAccountId", "date");

-- CreateIndex
CREATE INDEX "BankStatementLine_status_idx" ON "BankStatementLine"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementLine_chartAccountId_fingerprint_key" ON "BankStatementLine"("chartAccountId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_docNumber_key" ON "SupplierPayment"("docNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_idempotencyKey_key" ON "SupplierPayment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SupplierPayment_supplierId_date_idx" ON "SupplierPayment"("supplierId", "date");

-- CreateIndex
CREATE INDEX "SupplierPayment_status_idx" ON "SupplierPayment"("status");

-- CreateIndex
CREATE INDEX "SupplierPayment_date_idx" ON "SupplierPayment"("date");

-- CreateIndex
CREATE INDEX "SupplierPaymentAllocation_paymentId_idx" ON "SupplierPaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "SupplierPaymentAllocation_targetType_targetId_idx" ON "SupplierPaymentAllocation"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "Budget_year_month_idx" ON "Budget"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_chartAccountId_year_month_key" ON "Budget"("chartAccountId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "TaxPayment_idempotencyKey_key" ON "TaxPayment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "TaxPayment_type_period_idx" ON "TaxPayment"("type", "period");

-- CreateIndex
CREATE INDEX "TaxPayment_paidAt_idx" ON "TaxPayment"("paidAt");

-- CreateIndex
CREATE INDEX "TaxPayment_status_idx" ON "TaxPayment"("status");

-- CreateIndex
CREATE INDEX "TaxPeriodRecap_status_idx" ON "TaxPeriodRecap"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TaxPeriodRecap_type_period_key" ON "TaxPeriodRecap"("type", "period");

-- CreateIndex
CREATE INDEX "OpeningBalanceImport_kind_status_idx" ON "OpeningBalanceImport"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Journal_reversalOfId_key" ON "Journal"("reversalOfId");

-- CreateIndex
CREATE INDEX "Journal_status_date_idx" ON "Journal"("status", "date");

-- CreateIndex
CREATE INDEX "JournalLine_channel_idx" ON "JournalLine"("channel");

-- CreateIndex
CREATE INDEX "JournalLine_storeId_idx" ON "JournalLine"("storeId");

