const path = require("node:path");
const { existsSync } = require("node:fs");
const repoRoot = path.resolve(__dirname, "..");
for (const envPath of [
  path.join(repoRoot, "packages", "db", ".env"),
  path.join(repoRoot, "apps", "web", ".env"),
]) {
  if (existsSync(envPath)) {
    require("dotenv").config({ path: envPath });
    break;
  }
}
const { prisma } = require(path.join(repoRoot, "packages", "db", "dist", "src", "index.js"));
const woId = "cmsy4dd3j000jmk7k7xnn5vyf";

async function main() {
  const wo = await prisma.workOrder.findUnique({
    where: { id: woId },
    select: {
      id: true,
      docNumber: true,
      status: true,
      plannedQty: true,
      actualQty: true,
      issuedAt: true,
      completedAt: true,
      chainTotalDays: true,
      actualLeadDays: true,
      poId: true,
      consumptionMaterialId: true,
      rollBreakdown: true,
    },
  });
  const issues = await prisma.materialIssue.findMany({
    where: { woId },
    select: { docNumber: true, issueType: true, totalCost: true },
  });
  const receipts = await prisma.fGReceipt.findMany({
    where: { woId },
    select: {
      docNumber: true,
      qtyReceived: true,
      qtyAccepted: true,
      qtyRejected: true,
      totalCostValue: true,
    },
  });
  const fg = await prisma.item.findUnique({
    where: { sku: "FG-SHIRT-001" },
    select: { inventoryValues: { select: { variantSku: true, qtyOnHand: true } } },
  });
  const fabric = await prisma.item.findUnique({
    where: { sku: "FAB-COT-001" },
    select: { inventoryValues: { select: { variantSku: true, qtyOnHand: true } } },
  });
  const plan = await prisma.planYear.findUnique({
    where: { year: 2099 },
    include: { categories: { include: { cmtAllocations: true } } },
  });
  const outbox = await prisma.jubelioOutbox.count();
  console.log(
    JSON.stringify(
      {
        outbox,
        wo: wo
          ? {
              ...wo,
              plannedQty: Number(wo.plannedQty),
              actualQty: wo.actualQty == null ? null : Number(wo.actualQty),
            }
          : null,
        issues,
        receipts: receipts.map((r) => ({
          ...r,
          qtyReceived: Number(r.qtyReceived),
          qtyAccepted: Number(r.qtyAccepted),
          qtyRejected: Number(r.qtyRejected),
          totalCostValue: Number(r.totalCostValue),
        })),
        fg: fg?.inventoryValues,
        fabric: fabric?.inventoryValues,
        cmt: plan?.categories.flatMap((c) =>
          c.cmtAllocations.map((a) => ({ id: a.id, workOrderId: a.workOrderId, qty: Number(a.qty) }))
        ),
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
