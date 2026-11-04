-- The consignment chain: one cycle per shop per month.
--
-- Everything hangs off one ConsignmentCycle row, including the three document
-- numbers that used to live in three different people's heads: ours, the sales
-- admin's nota, and the tax admin's faktur pajak. They are genuinely unrelated
-- numbers; putting them side by side in one row is the point.
--
-- Consigned stock is shipped minus sold, DERIVED at read time. Storing it gives
-- a number that drifts from the two it is made of.
--
-- Re-runnable: every statement is guarded.

DO $$ BEGIN
  CREATE TYPE "ConsignmentReportSource" AS ENUM ('SPG', 'TOKO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "commissionPerPcs" DECIMAL(15,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "ConsignmentCycle" (
    "id" TEXT NOT NULL,
    "noKonsi" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "spgDueDate" TIMESTAMP(3),
    "noNota" TEXT,
    "notaAt" TIMESTAMP(3),
    "noFakturPajak" TEXT,
    "fakturPajakAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lockedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConsignmentCycle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ConsignmentCycle_noKonsi_key" ON "ConsignmentCycle"("noKonsi");
-- One cycle per shop per month. Two cycles for the same month would split the
-- sold figures and every downstream total silently halves.
CREATE UNIQUE INDEX IF NOT EXISTS "ConsignmentCycle_store_period_key"
  ON "ConsignmentCycle"("storeId", "periodYear", "periodMonth");
CREATE INDEX IF NOT EXISTS "ConsignmentCycle_storeId_idx" ON "ConsignmentCycle"("storeId");
CREATE INDEX IF NOT EXISTS "ConsignmentCycle_period_idx" ON "ConsignmentCycle"("periodYear", "periodMonth");

CREATE TABLE IF NOT EXISTS "ConsignmentShipment" (
    "id" TEXT NOT NULL,
    "noKirim" TEXT NOT NULL,
    "cycleId" TEXT,
    "storeId" TEXT NOT NULL,
    "shippedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConsignmentShipment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ConsignmentShipment_noKirim_key" ON "ConsignmentShipment"("noKirim");
CREATE INDEX IF NOT EXISTS "ConsignmentShipment_cycleId_idx" ON "ConsignmentShipment"("cycleId");
CREATE INDEX IF NOT EXISTS "ConsignmentShipment_storeId_idx" ON "ConsignmentShipment"("storeId");

CREATE TABLE IF NOT EXISTS "ConsignmentShipmentItem" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "itemId" TEXT,
    "itemName" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "price" DECIMAL(15,2) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    CONSTRAINT "ConsignmentShipmentItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ConsignmentShipmentItem_shipmentId_idx" ON "ConsignmentShipmentItem"("shipmentId");
CREATE INDEX IF NOT EXISTS "ConsignmentShipmentItem_itemId_idx" ON "ConsignmentShipmentItem"("itemId");

-- Two reports per cycle at most: one from the SPG, one from the shop. The
-- unique key is what makes "both reports are in" a fact rather than a count.
CREATE TABLE IF NOT EXISTS "ConsignmentReport" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "source" "ConsignmentReportSource" NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL,
    "reportedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConsignmentReport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ConsignmentReport_cycle_source_key" ON "ConsignmentReport"("cycleId", "source");
CREATE INDEX IF NOT EXISTS "ConsignmentReport_cycleId_idx" ON "ConsignmentReport"("cycleId");

CREATE TABLE IF NOT EXISTS "ConsignmentReportItem" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "itemId" TEXT,
    "itemName" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    CONSTRAINT "ConsignmentReportItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ConsignmentReportItem_reportId_idx" ON "ConsignmentReportItem"("reportId");
CREATE INDEX IF NOT EXISTS "ConsignmentReportItem_itemId_idx" ON "ConsignmentReportItem"("itemId");

-- The official figures. Not either raw report — the corrected set the admin
-- locked, which is what bills the shop, pays the commission and reduces stock.
CREATE TABLE IF NOT EXISTS "ConsignmentSold" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "itemId" TEXT,
    "itemName" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "price" DECIMAL(15,2) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "commissionPerPcs" DECIMAL(15,2) NOT NULL DEFAULT 0,
    CONSTRAINT "ConsignmentSold_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ConsignmentSold_cycleId_idx" ON "ConsignmentSold"("cycleId");
CREATE INDEX IF NOT EXISTS "ConsignmentSold_itemId_idx" ON "ConsignmentSold"("itemId");

CREATE TABLE IF NOT EXISTS "ConsignmentCommission" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "spgUserId" TEXT NOT NULL,
    "baseSalary" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "commission" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConsignmentCommission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ConsignmentCommission_cycle_spg_key" ON "ConsignmentCommission"("cycleId", "spgUserId");
CREATE INDEX IF NOT EXISTS "ConsignmentCommission_cycleId_idx" ON "ConsignmentCommission"("cycleId");
CREATE INDEX IF NOT EXISTS "ConsignmentCommission_spgUserId_idx" ON "ConsignmentCommission"("spgUserId");
