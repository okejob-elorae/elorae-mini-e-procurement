-- Two-sided store returns: the shop's claim (NRT) and the warehouse's count (NRI).
-- Re-runnable: every statement is guarded, so a partial apply can be repeated safely.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "StoreReturnStatus" AS ENUM ('DIAJUKAN', 'DIHITUNG', 'SELESAI', 'BATAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ReturnBearer" AS ENUM ('TOKO', 'SALES', 'PERUSAHAAN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "StoreReturn" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "salesmanId" TEXT,
    "claimDate" TIMESTAMP(3) NOT NULL,
    "claimedAmount" DECIMAL(15,2) NOT NULL,
    "countedAmount" DECIMAL(15,2),
    "countedAt" TIMESTAMP(3),
    "countedById" TEXT,
    "bearer" "ReturnBearer",
    "bearerReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "status" "StoreReturnStatus" NOT NULL DEFAULT 'DIAJUKAN',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreReturn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "StoreReturn_docNo_key" ON "StoreReturn"("docNo");
CREATE INDEX IF NOT EXISTS "StoreReturn_storeId_status_idx" ON "StoreReturn"("storeId", "status");
CREATE INDEX IF NOT EXISTS "StoreReturn_status_idx" ON "StoreReturn"("status");
CREATE INDEX IF NOT EXISTS "StoreReturn_claimDate_idx" ON "StoreReturn"("claimDate");

-- No foreign key is declared: relationMode = "prisma" carries the relation in the
-- client, not the database. `PaymentClaimDeduction.storeReturnId` has existed since
-- the piutang migration as a dangling column waiting for this table, so any row
-- written before now points at nothing and the readers tolerate it.
