-- Modul creative marketing: KOL, brief, dan rencana konten.
--
-- Barang yang dikirim ke KOL keluar lewat StockAdjustment bersumber
-- 'KOL_SEEDING' — kolom source sudah bertipe String, jadi tidak ada enum
-- yang perlu diperlebar.

-- CreateEnum
CREATE TYPE "KolPlatform" AS ENUM ('INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'LAINNYA');

-- CreateEnum
CREATE TYPE "KolBriefStatus" AS ENUM ('DRAFT', 'DIKIRIM', 'DISETUJUI', 'KONTEN_DITERIMA', 'TAYANG', 'SELESAI', 'BATAL');

-- CreateEnum
CREATE TYPE "ContentFormat" AS ENUM ('FEED', 'REELS', 'STORY', 'VIDEO', 'LIVE', 'CAROUSEL');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('IDE', 'DRAFT', 'REVIEW', 'DIJADWALKAN', 'TAYANG', 'BATAL');

-- CreateTable
CREATE TABLE "Kol" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "niche" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "rateCard" DECIMAL(15,2),
    "rateNote" TEXT,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Kol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KolAccount" (
    "id" TEXT NOT NULL,
    "kolId" TEXT NOT NULL,
    "platform" "KolPlatform" NOT NULL,
    "handle" TEXT NOT NULL,
    "followers" INTEGER NOT NULL DEFAULT 0,
    "url" TEXT,

    CONSTRAINT "KolAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KolBrief" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "kolId" TEXT NOT NULL,
    "campaign" TEXT NOT NULL,
    "status" "KolBriefStatus" NOT NULL DEFAULT 'DRAFT',
    "fee" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "briefText" TEXT,
    "doList" TEXT,
    "dontList" TEXT,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "liveAt" TIMESTAMP(3),
    "stockIssuedAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KolBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KolBriefDeliverable" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "platform" "KolPlatform" NOT NULL,
    "format" "ContentFormat" NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "dueDate" TIMESTAMP(3),

    CONSTRAINT "KolBriefDeliverable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KolBriefItem" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "variantSku" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "KolBriefItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPlan" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "platform" "KolPlatform" NOT NULL,
    "format" "ContentFormat" NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'IDE',
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "postUrl" TEXT,
    "imageUrl" TEXT,
    "caption" TEXT,
    "note" TEXT,
    "itemId" TEXT,
    "assigneeId" TEXT,
    "briefId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Kol_isActive_name_idx" ON "Kol"("isActive", "name");

-- CreateIndex
CREATE INDEX "Kol_createdById_idx" ON "Kol"("createdById");

-- CreateIndex
CREATE INDEX "KolAccount_kolId_idx" ON "KolAccount"("kolId");

-- CreateIndex
CREATE UNIQUE INDEX "KolAccount_kolId_platform_handle_key" ON "KolAccount"("kolId", "platform", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "KolBrief_docNo_key" ON "KolBrief"("docNo");

-- CreateIndex
CREATE INDEX "KolBrief_kolId_idx" ON "KolBrief"("kolId");

-- CreateIndex
CREATE INDEX "KolBrief_status_idx" ON "KolBrief"("status");

-- CreateIndex
CREATE INDEX "KolBrief_createdById_idx" ON "KolBrief"("createdById");

-- CreateIndex
CREATE INDEX "KolBriefDeliverable_briefId_idx" ON "KolBriefDeliverable"("briefId");

-- CreateIndex
CREATE INDEX "KolBriefItem_briefId_idx" ON "KolBriefItem"("briefId");

-- CreateIndex
CREATE INDEX "KolBriefItem_itemId_idx" ON "KolBriefItem"("itemId");

-- CreateIndex
CREATE INDEX "ContentPlan_status_scheduledAt_idx" ON "ContentPlan"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "ContentPlan_briefId_idx" ON "ContentPlan"("briefId");

-- CreateIndex
CREATE INDEX "ContentPlan_itemId_idx" ON "ContentPlan"("itemId");

-- CreateIndex
CREATE INDEX "ContentPlan_assigneeId_idx" ON "ContentPlan"("assigneeId");

-- CreateIndex
CREATE INDEX "ContentPlan_createdById_idx" ON "ContentPlan"("createdById");

