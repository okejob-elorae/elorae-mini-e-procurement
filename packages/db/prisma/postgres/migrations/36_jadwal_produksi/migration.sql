-- Jadwal produksi per tahap Plan Kerja (2026-10-07), meniru alur program SSG:
-- setiap tahap (PlanStage) punya langkah proses bertanggal yang ditarik dari
-- Lead Time pemasok, dihitung dalam HARI KERJA (melewati akhir pekan dan
-- tanggal merah), dan bergeser bila satu langkah selesai lebih cepat/lambat.
-- PO bisa ditautkan ke tahap (PurchaseOrder.planStageId) supaya terlihat
-- "sudah di-PO / belum". Tanpa foreign key (relationMode = prisma).

-- CreateEnum
CREATE TYPE "PlanStepStatus" AS ENUM ('BELUM', 'PROSES', 'SELESAI');

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "planStageId" TEXT;

-- AlterTable
ALTER TABLE "PlanStage" ADD COLUMN     "deadline" TIMESTAMP(3),
ADD COLUMN     "scheduleStart" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PlanStageStep" (
    "id" TEXT NOT NULL,
    "planStageId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "processTemplateId" TEXT,
    "supplierId" TEXT,
    "durationDays" INTEGER NOT NULL,
    "targetDate" TIMESTAMP(3) NOT NULL,
    "doneDate" TIMESTAMP(3),
    "status" "PlanStepStatus" NOT NULL DEFAULT 'BELUM',
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanStageStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanStageStep_planStageId_idx" ON "PlanStageStep"("planStageId");

-- CreateIndex
CREATE INDEX "PlanStageStep_status_targetDate_idx" ON "PlanStageStep"("status", "targetDate");

-- CreateIndex
CREATE INDEX "PlanStageStep_supplierId_idx" ON "PlanStageStep"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_planStageId_idx" ON "PurchaseOrder"("planStageId");

