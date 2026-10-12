/**
 * Snapshot production smoke entities. Usage:
 *   $env:SMOKE_DB_PACKAGE_ROOT="packages/db"
 *   node test-run/inspect-production-smoke.cjs
 */
const path = require("node:path");
const { existsSync } = require("node:fs");

const repoRoot = path.resolve(__dirname, "..");
for (const envPath of [
  path.join(repoRoot, "packages", "db", ".env"),
  path.join(repoRoot, "apps", "web", ".env"),
  path.join(repoRoot, ".env"),
]) {
  if (existsSync(envPath)) {
    require("dotenv").config({ path: envPath });
    break;
  }
}

const dbRootRaw = process.env.SMOKE_DB_PACKAGE_ROOT;
if (!dbRootRaw) throw new Error("SMOKE_DB_PACKAGE_ROOT is required");
const dbRoot = path.isAbsolute(dbRootRaw)
  ? dbRootRaw
  : path.resolve(__dirname, "..", dbRootRaw);

const { prisma } = require(path.join(dbRoot, "dist", "src", "index.js"));

async function main() {
  const fg = await prisma.item.findUnique({
    where: { sku: "FG-SHIRT-001" },
    select: {
      id: true,
      sku: true,
      inventoryValues: { select: { variantSku: true, qtyOnHand: true } },
    },
  });
  const fabric = await prisma.item.findUnique({
    where: { sku: "FAB-COT-001" },
    select: {
      id: true,
      sku: true,
      inventoryValues: { select: { variantSku: true, qtyOnHand: true } },
    },
  });

  const planYear = await prisma.planYear.findUnique({
    where: { year: 2099 },
    include: {
      categories: {
        include: {
          colorAllocations: true,
          cmtAllocations: true,
          monthlyTargets: true,
        },
      },
    },
  });

  const leaf = planYear?.categories.find((c) => c.itemId === fg?.id) ?? null;
  const cmt = leaf?.cmtAllocations[0] ?? null;

  const wo = cmt?.workOrderId
    ? await prisma.workOrder.findUnique({
        where: { id: cmt.workOrderId },
        select: {
          id: true,
          docNumber: true,
          status: true,
          plannedQty: true,
          actualQty: true,
          issuedAt: true,
          completedAt: true,
          poId: true,
          consumptionMaterialId: true,
          rollBreakdown: true,
          chainTotalDays: true,
          actualLeadDays: true,
          chainSnapshot: true,
        },
      })
    : null;

  const issues = wo
    ? await prisma.materialIssue.findMany({
        where: { woId: wo.id },
        select: {
          id: true,
          docNumber: true,
          issueType: true,
          totalCost: true,
        },
      })
    : [];

  const receipts = wo
    ? await prisma.fGReceipt.findMany({
        where: { woId: wo.id },
        select: {
          id: true,
          docNumber: true,
          qtyReceived: true,
          qtyAccepted: true,
        },
      })
    : [];

  const rolls = fabric
    ? await prisma.fabricRoll.findMany({
        where: { itemId: fabric.id },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          rollCode: true,
          rollRef: true,
          initialLength: true,
          remainingLength: true,
          isClosed: true,
          grnId: true,
          createdAt: true,
        },
      })
    : [];

  const pos = await prisma.purchaseOrder.findMany({
    where: {
      notes: { contains: "SMOKE-PROD" },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: {
      items: {
        select: {
          itemId: true,
          qty: true,
          receivedQty: true,
        },
      },
      supplier: { select: { code: true } },
    },
  });

  const outboxCount = await prisma.jubelioOutbox.count();

  console.log(
    JSON.stringify(
      {
        outboxCount,
        planYear: planYear
          ? {
              id: planYear.id,
              year: planYear.year,
              status: planYear.status,
              isLocked: planYear.isLocked,
              leafId: leaf?.id ?? null,
              m1: leaf?.monthlyTargets.find((m) => m.month === 1) ?? null,
              colorQty: leaf?.colorAllocations[0]?.allocatedQty ?? null,
              cmtWorkOrderId: cmt?.workOrderId ?? null,
            }
          : null,
        wo: wo
          ? {
              ...wo,
              plannedQty: Number(wo.plannedQty),
              actualQty: wo.actualQty == null ? null : Number(wo.actualQty),
              chainSnapshotLen: Array.isArray(wo.chainSnapshot)
                ? wo.chainSnapshot.length
                : wo.chainSnapshot
                  ? 1
                  : 0,
              rollBreakdown: wo.rollBreakdown,
            }
          : null,
        issues,
        receipts,
        fabricQtyOnHand: fabric?.inventoryValues ?? [],
        fgQtyOnHand: fg?.inventoryValues ?? [],
        recentRolls: rolls.map((r) => ({
          ...r,
          initialLength: Number(r.initialLength),
          remainingLength: Number(r.remainingLength),
        })),
        smokePos: pos.map((p) => ({
          id: p.id,
          docNumber: p.docNumber,
          status: p.status,
          supplier: p.supplier.code,
          chainTotalDays: p.chainTotalDays,
          hasChainSnapshot: p.chainSnapshot != null,
          etaDate: p.etaDate,
          items: p.items.map((i) => ({
            qty: Number(i.qty),
            receivedQty: Number(i.receivedQty),
          })),
        })),
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
