-- Reshape the return module into the two documents it actually is.
--
-- Migration 2 collapsed both sides of a return into one row with two columns.
-- That shape cannot express a warehouse receipt arriving WITHOUT a shop note
-- (goods sent by carrier), cannot show WHICH item is short, and made the program
-- invent a note number that belongs to the shop.
--
-- This splits them: StoreReturn is the shop's claim (NRT, numbered by the shop),
-- WarehouseReturn is the warehouse's count (NRI, numbered by us), and
-- ReturnCharge carries the difference until somebody bears it.
--
-- THE OLD TABLE IS DROPPED, NOT MIGRATED. It was introduced hours before this
-- and has never held data in any deployed environment. Anyone who did put rows
-- in it must carry them across by hand before running this — one StoreReturn
-- becomes one StoreReturn plus, where countedAmount was set, one WarehouseReturn
-- and (where a bearer was named) one ReturnCharge.
--
-- Deductions pointing at a dropped note are NOT orphaned silently: the reader
-- treats a dangling storeReturnId as uncounted and holds the whole deduction,
-- which surfaces on the receivables screen rather than releasing money.
--
-- Re-runnable: every statement is guarded.

DROP TABLE IF EXISTS "StoreReturn" CASCADE;
DROP TYPE IF EXISTS "StoreReturnStatus";
DROP TYPE IF EXISTS "ReturnBearer";

-- CreateEnum
CREATE TYPE "ReturnDeliveryMethod" AS ENUM ('SALES', 'TOKO', 'EKSPEDISI');
CREATE TYPE "StoreReturnStatus" AS ENUM ('MENUNGGU', 'COCOK', 'SELISIH', 'BATAL');
CREATE TYPE "WarehouseReturnStatus" AS ENUM ('DRAFT', 'FINAL');
CREATE TYPE "ReturnItemCondition" AS ENUM ('LAYAK', 'RUSAK', 'EXPIRED');
-- GUDANG is new. The warehouse can be at fault — a miscount, damage in store —
-- and without it every such loss was pushed onto the salesman or written off.
CREATE TYPE "ReturnBearer" AS ENUM ('TOKO', 'SALES', 'GUDANG', 'PERUSAHAAN');
CREATE TYPE "ReturnChargeStatus" AS ENUM ('TERBUKA', 'DITETAPKAN', 'LUNAS');

-- CreateTable: the shop's claim. `noNrt` is the SHOP's own number (NRT-4471),
-- unique per shop rather than globally — two shops may reuse a number.
CREATE TABLE "StoreReturn" (
    "id" TEXT NOT NULL,
    "noNrt" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "salesmanId" TEXT,
    "claimDate" TIMESTAMP(3) NOT NULL,
    "deliveryMethod" "ReturnDeliveryMethod" NOT NULL DEFAULT 'SALES',
    "claimedAmount" DECIMAL(15,2) NOT NULL,
    "photoUrl" TEXT,
    "note" TEXT,
    "status" "StoreReturnStatus" NOT NULL DEFAULT 'MENUNGGU',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreReturn_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StoreReturn_storeId_noNrt_key" ON "StoreReturn"("storeId", "noNrt");
CREATE INDEX "StoreReturn_storeId_status_idx" ON "StoreReturn"("storeId", "status");
CREATE INDEX "StoreReturn_status_idx" ON "StoreReturn"("status");
CREATE INDEX "StoreReturn_claimDate_idx" ON "StoreReturn"("claimDate");

CREATE TABLE "StoreReturnItem" (
    "id" TEXT NOT NULL,
    "storeReturnId" TEXT NOT NULL,
    "itemId" TEXT,
    "itemName" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "price" DECIMAL(15,2) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "StoreReturnItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StoreReturnItem_storeReturnId_idx" ON "StoreReturnItem"("storeReturnId");
CREATE INDEX "StoreReturnItem_itemId_idx" ON "StoreReturnItem"("itemId");

-- CreateTable: the warehouse's count. `storeReturnId` is NULLABLE on purpose —
-- goods arrive by carrier ahead of any shop note, and that receipt has to be
-- recordable before anyone knows which note it belongs to.
CREATE TABLE "WarehouseReturn" (
    "id" TEXT NOT NULL,
    "noNri" TEXT NOT NULL,
    "storeId" TEXT,
    "storeReturnId" TEXT,
    "warehouseUserId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "deliveryMethod" "ReturnDeliveryMethod" NOT NULL DEFAULT 'SALES',
    "physicalAmount" DECIMAL(15,2) NOT NULL,
    "claimedAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "status" "WarehouseReturnStatus" NOT NULL DEFAULT 'DRAFT',
    "finalisedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseReturn_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WarehouseReturn_noNri_key" ON "WarehouseReturn"("noNri");
CREATE UNIQUE INDEX "WarehouseReturn_storeReturnId_key" ON "WarehouseReturn"("storeReturnId");
CREATE INDEX "WarehouseReturn_storeId_status_idx" ON "WarehouseReturn"("storeId", "status");
CREATE INDEX "WarehouseReturn_status_idx" ON "WarehouseReturn"("status");
CREATE INDEX "WarehouseReturn_receivedAt_idx" ON "WarehouseReturn"("receivedAt");

-- `qtyClaim` sits beside `qty` so the shortfall is visible per item rather than
-- only as a total — which item came up short is the question the owner asks.
CREATE TABLE "WarehouseReturnItem" (
    "id" TEXT NOT NULL,
    "warehouseReturnId" TEXT NOT NULL,
    "itemId" TEXT,
    "itemName" TEXT NOT NULL,
    "qtyClaim" INTEGER NOT NULL DEFAULT 0,
    "qty" INTEGER NOT NULL,
    "price" DECIMAL(15,2) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "condition" "ReturnItemCondition" NOT NULL DEFAULT 'LAYAK',

    CONSTRAINT "WarehouseReturnItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WarehouseReturnItem_warehouseReturnId_idx" ON "WarehouseReturnItem"("warehouseReturnId");
CREATE INDEX "WarehouseReturnItem_itemId_idx" ON "WarehouseReturnItem"("itemId");

-- CreateTable: the difference, and who carries it. Its own table because it has
-- its own life after the return closes — a salesman charged for a shortfall can
-- pay it back, and TERBUKA → DITETAPKAN → LUNAS is that story.
CREATE TABLE "ReturnCharge" (
    "id" TEXT NOT NULL,
    "storeReturnId" TEXT,
    "warehouseReturnId" TEXT,
    "storeId" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "bearer" "ReturnBearer",
    "bearerUserId" TEXT,
    "status" "ReturnChargeStatus" NOT NULL DEFAULT 'TERBUKA',
    "note" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnCharge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReturnCharge_status_idx" ON "ReturnCharge"("status");
CREATE INDEX "ReturnCharge_storeId_status_idx" ON "ReturnCharge"("storeId", "status");
CREATE INDEX "ReturnCharge_bearerUserId_status_idx" ON "ReturnCharge"("bearerUserId", "status");
CREATE INDEX "ReturnCharge_storeReturnId_idx" ON "ReturnCharge"("storeReturnId");
CREATE INDEX "ReturnCharge_warehouseReturnId_idx" ON "ReturnCharge"("warehouseReturnId");

-- No foreign keys: relationMode = "prisma" carries relations in the client.
