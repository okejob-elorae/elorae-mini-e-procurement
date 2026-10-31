-- CreateEnum
CREATE TYPE "ReceivableSource" AS ENUM ('DELIVERY', 'IMPORT', 'MANUAL');

-- CreateEnum
CREATE TYPE "CollectionNoteStatus" AS ENUM ('BERJALAN', 'SELESAI', 'BATAL');

-- CreateEnum
CREATE TYPE "PaymentClaimStatus" AS ENUM ('DIKIRIM', 'TERVERIFIKASI', 'DITOLAK');

-- CreateEnum
CREATE TYPE "DeductionMethod" AS ENUM ('NOMINAL', 'PERSEN', 'DARI_RETUR');

-- CreateTable
CREATE TABLE "Receivable" (
    "id" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "outstanding" DECIMAL(15,2) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "source" "ReceivableSource" NOT NULL DEFAULT 'DELIVERY',
    "deliveryId" TEXT,
    "salesmanId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receivable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionNote" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "salesmanId" TEXT NOT NULL,
    "handoverDate" TIMESTAMP(3) NOT NULL,
    "promisedDate" TIMESTAMP(3) NOT NULL,
    "receivedBy" TEXT,
    "amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "photoUrl" TEXT,
    "note" TEXT,
    "status" "CollectionNoteStatus" NOT NULL DEFAULT 'BERJALAN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionNoteReceivable" (
    "collectionNoteId" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "CollectionNoteReceivable_pkey" PRIMARY KEY ("collectionNoteId","receivableId")
);

-- CreateTable
CREATE TABLE "PaymentClaim" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "salesmanId" TEXT NOT NULL,
    "collectionNoteId" TEXT,
    "claimedTransferAt" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'transfer',
    "invoiceAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "deductionTotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "receivedAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "transferPhotoUrl" TEXT,
    "breakdownPhotoUrl" TEXT,
    "status" "PaymentClaimStatus" NOT NULL DEFAULT 'DIKIRIM',
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifyNote" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentClaimReceivable" (
    "paymentClaimId" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "settledAmount" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "PaymentClaimReceivable_pkey" PRIMARY KEY ("paymentClaimId","receivableId")
);

-- CreateTable
CREATE TABLE "DeductionType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "method" "DeductionMethod" NOT NULL DEFAULT 'NOMINAL',
    "allowManual" BOOLEAN NOT NULL DEFAULT true,
    "pkpOnly" BOOLEAN NOT NULL DEFAULT false,
    "noteRequired" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DeductionType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentClaimDeduction" (
    "id" TEXT NOT NULL,
    "paymentClaimId" TEXT NOT NULL,
    "deductionTypeId" TEXT,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "storeReturnId" TEXT,

    CONSTRAINT "PaymentClaimDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Receivable_invoiceNo_key" ON "Receivable"("invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "Receivable_deliveryId_key" ON "Receivable"("deliveryId");

-- CreateIndex
CREATE INDEX "Receivable_storeId_outstanding_idx" ON "Receivable"("storeId", "outstanding");

-- CreateIndex
CREATE INDEX "Receivable_dueDate_idx" ON "Receivable"("dueDate");

-- CreateIndex
CREATE INDEX "Receivable_salesmanId_idx" ON "Receivable"("salesmanId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionNote_docNo_key" ON "CollectionNote"("docNo");

-- CreateIndex
CREATE INDEX "CollectionNote_storeId_status_idx" ON "CollectionNote"("storeId", "status");

-- CreateIndex
CREATE INDEX "CollectionNote_promisedDate_idx" ON "CollectionNote"("promisedDate");

-- CreateIndex
CREATE INDEX "CollectionNoteReceivable_receivableId_idx" ON "CollectionNoteReceivable"("receivableId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentClaim_docNo_key" ON "PaymentClaim"("docNo");

-- CreateIndex
CREATE INDEX "PaymentClaim_storeId_status_idx" ON "PaymentClaim"("storeId", "status");

-- CreateIndex
CREATE INDEX "PaymentClaim_status_createdAt_idx" ON "PaymentClaim"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentClaimReceivable_receivableId_idx" ON "PaymentClaimReceivable"("receivableId");

-- CreateIndex
CREATE UNIQUE INDEX "DeductionType_name_key" ON "DeductionType"("name");

-- CreateIndex
CREATE INDEX "PaymentClaimDeduction_paymentClaimId_idx" ON "PaymentClaimDeduction"("paymentClaimId");

-- CreateIndex
CREATE INDEX "PaymentClaimDeduction_storeReturnId_idx" ON "PaymentClaimDeduction"("storeReturnId");
