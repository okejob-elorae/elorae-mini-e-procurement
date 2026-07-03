/**
 * Remove preview seed data (packages/db/prisma/seed.ts) while preserving:
 * - Users, Account, Session, VerificationToken
 * - RBAC (Permission, RoleDefinition, RolePermission)
 * - System settings (SystemSetting, UOM, UOMConversion, DocNumberConfig, ItemTypeMaster)
 * - Pantone catalog
 * - Jubelio integration tables
 * - Any master/transactional records NOT tied to seed fingerprints
 *
 * Usage:
 *   pnpm -F @elorae/db unseed              # dry-run (default)
 *   pnpm -F @elorae/db unseed -- --execute  # apply deletions
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient, Prisma } from "../generated/prisma/client";
import { getDatabaseUrl } from "../src/db-connection";

const here = dirname(fileURLToPath(import.meta.url));
for (const p of [
  join(here, "../.env"),
  join(here, "../../../apps/web/.env"),
  join(here, "../../../.env"),
]) {
  if (existsSync(p)) {
    loadEnv({ path: p });
    break;
  }
}

const databaseUrl = getDatabaseUrl() || process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set (check apps/web/.env)");
  process.exit(1);
}

const adapter = new PrismaMariaDb(databaseUrl);
const prisma = new PrismaClient({ adapter });

const EXECUTE = process.argv.includes("--execute");

const SEED_SUPPLIER_CODES = ["SUP0001", "SUP0002", "SUP0003", "SUP0004", "SUP0005"] as const;
const SEED_SUPPLIER_TYPE_IDS = ["st-fabric", "st-accessories", "st-tailor", "st-other"] as const;
const SEED_ITEM_SKUS = [
  "FAB-COT-001",
  "FAB-POL-001",
  "FAB-DEN-001",
  "FAB-LIN-001",
  "FB-COTTON-POP",
  "ACC-BTN-001",
  "ACC-ZIP-001",
  "ACC-THD-001",
  "ACC-RIV-001",
  "ACC-SHB-001",
  "ACC-ZIP-002",
  "FAB-COT-DRILL-001",
  "FG-SHIRT-001",
  "FG-JKT-001",
  "FG-POLO-001",
  "FG-JEANS-001",
  "FB-001",
  "AC-001",
  "AC-002",
  "AC-003",
  "AC-004",
  "AC-005",
  "2700001",
] as const;

const SEED_WO_DOC_NUMBERS = ["WO/2026/HPP01"] as const;

type Counts = Record<string, number>;

async function purge(
  label: string,
  where: object,
  model:
    | "planAccessory"
    | "planCmtAllocation"
    | "vendorReturn"
    | "fabricRoll"
    | "materialIssue"
    | "fGReceipt"
    | "workOrderStep"
    | "workOrder"
    | "gRN"
    | "purchaseOrder"
    | "stockMovement"
    | "stockAdjustment"
    | "rejectedGoodsLedger"
    | "consumptionRule"
    | "inventoryValue"
    | "jubelioProductMapping"
    | "auditLog"
    | "item"
    | "supplier"
    | "supplierType",
  counts: Counts,
): Promise<void> {
  const delegate = prisma[model] as {
    count: (args: { where: object }) => Promise<number>;
    deleteMany: (args: { where: object }) => Promise<{ count: number }>;
  };
  const n = await delegate.count({ where });
  counts[label] = n;
  if (n === 0) return;
  if (EXECUTE) {
    await delegate.deleteMany({ where });
    console.log(`  deleted ${label}: ${n}`);
  } else {
    console.log(`  would delete ${label}: ${n}`);
  }
}

async function main() {
  console.log(EXECUTE ? "Unseeding database (EXECUTE)..." : "Unseed dry-run (pass --execute to apply)...");

  const seedSuppliers = await prisma.supplier.findMany({
    where: { code: { in: [...SEED_SUPPLIER_CODES] } },
    select: { id: true, code: true },
  });
  const seedItems = await prisma.item.findMany({
    where: { sku: { in: [...SEED_ITEM_SKUS] } },
    select: { id: true, sku: true },
  });

  const seedSupplierIds = seedSuppliers.map((s) => s.id);
  const seedItemIds = seedItems.map((i) => i.id);

  console.log(`Seed suppliers found: ${seedSuppliers.length} (${seedSuppliers.map((s) => s.code).join(", ") || "none"})`);
  console.log(`Seed items found: ${seedItems.length}`);

  if (seedSupplierIds.length === 0 && seedItemIds.length === 0) {
    console.log("No seed master records found. Nothing to clean.");
    return;
  }

  const seedWorkOrders = await prisma.workOrder.findMany({
    where: {
      OR: [
        ...(seedSupplierIds.length ? [{ vendorId: { in: seedSupplierIds } }] : []),
        ...(seedItemIds.length ? [{ finishedGoodId: { in: seedItemIds } }] : []),
        ...(seedItemIds.length ? [{ consumptionMaterialId: { in: seedItemIds } }] : []),
        { docNumber: { in: [...SEED_WO_DOC_NUMBERS] } },
      ],
    },
    select: { id: true },
  });
  const seedWorkOrderIds = seedWorkOrders.map((wo) => wo.id);

  const seedPurchaseOrders = await prisma.purchaseOrder.findMany({
    where: {
      OR: [
        ...(seedSupplierIds.length ? [{ supplierId: { in: seedSupplierIds } }] : []),
        ...(seedItemIds.length
          ? [{ items: { some: { itemId: { in: seedItemIds } } } }]
          : []),
      ],
    },
    select: { id: true },
  });
  const seedPurchaseOrderIds = seedPurchaseOrders.map((po) => po.id);

  const seedGrns = await prisma.gRN.findMany({
    where: {
      OR: [
        ...(seedSupplierIds.length ? [{ supplierId: { in: seedSupplierIds } }] : []),
        ...(seedPurchaseOrderIds.length ? [{ poId: { in: seedPurchaseOrderIds } }] : []),
      ],
    },
    select: { id: true },
  });
  const seedGrnIds = seedGrns.map((g) => g.id);

  const counts: Counts = {};
  const verb = EXECUTE ? "Deleting" : "Would delete";
  console.log(`\n${verb} seed-linked data...`);

  if (seedWorkOrderIds.length > 0) {
    const planStageN = await prisma.planStage.count({
      where: { workOrderId: { in: seedWorkOrderIds } },
    });
    counts["PlanStage.workOrderId cleared"] = planStageN;
    if (planStageN > 0) {
      if (EXECUTE) {
        await prisma.planStage.updateMany({
          where: { workOrderId: { in: seedWorkOrderIds } },
          data: { workOrderId: null },
        });
        console.log(`  cleared PlanStage.workOrderId: ${planStageN}`);
      } else {
        console.log(`  would clear PlanStage.workOrderId: ${planStageN}`);
      }
    }
  }

  if (seedItemIds.length) {
    await purge("PlanAccessory", { itemId: { in: seedItemIds } }, "planAccessory", counts);
  }
  if (seedSupplierIds.length) {
    await purge(
      "PlanCmtAllocation",
      { supplierId: { in: seedSupplierIds } },
      "planCmtAllocation",
      counts,
    );
  }

  const vendorReturnWhere: Prisma.VendorReturnWhereInput = {
    OR: [
      ...(seedSupplierIds.length ? [{ vendorId: { in: seedSupplierIds } }] : []),
      ...(seedWorkOrderIds.length ? [{ woId: { in: seedWorkOrderIds } }] : []),
      ...(seedGrnIds.length ? [{ grnId: { in: seedGrnIds } }] : []),
    ],
  };
  if (vendorReturnWhere.OR?.length) {
    await purge("VendorReturn", vendorReturnWhere, "vendorReturn", counts);
  }

  const fabricRollWhere: Prisma.FabricRollWhereInput = {
    OR: [
      ...(seedGrnIds.length ? [{ grnId: { in: seedGrnIds } }] : []),
      ...(seedItemIds.length ? [{ itemId: { in: seedItemIds } }] : []),
    ],
  };
  if (fabricRollWhere.OR?.length) {
    await purge("FabricRoll", fabricRollWhere, "fabricRoll", counts);
  }

  if (seedWorkOrderIds.length) {
    await purge("MaterialIssue", { woId: { in: seedWorkOrderIds } }, "materialIssue", counts);
    await purge("FGReceipt", { woId: { in: seedWorkOrderIds } }, "fGReceipt", counts);
    await purge("WorkOrderStep", { woId: { in: seedWorkOrderIds } }, "workOrderStep", counts);
    await purge("WorkOrder", { id: { in: seedWorkOrderIds } }, "workOrder", counts);
  }
  if (seedGrnIds.length) {
    await purge("GRN", { id: { in: seedGrnIds } }, "gRN", counts);
  }
  if (seedPurchaseOrderIds.length) {
    await purge("PurchaseOrder", { id: { in: seedPurchaseOrderIds } }, "purchaseOrder", counts);
  }
  if (seedItemIds.length) {
    await purge("StockMovement", { itemId: { in: seedItemIds } }, "stockMovement", counts);
    await purge("StockAdjustment", { itemId: { in: seedItemIds } }, "stockAdjustment", counts);
    await purge("RejectedGoodsLedger", { itemId: { in: seedItemIds } }, "rejectedGoodsLedger", counts);
    await purge(
      "ConsumptionRule",
      {
        OR: [
          { finishedGoodId: { in: seedItemIds } },
          { materialId: { in: seedItemIds } },
        ],
      },
      "consumptionRule",
      counts,
    );
    await purge("InventoryValue", { itemId: { in: seedItemIds } }, "inventoryValue", counts);
    await purge(
      "JubelioProductMapping",
      { itemId: { in: seedItemIds } },
      "jubelioProductMapping",
      counts,
    );
  }

  const seedEntityIds = [...seedSupplierIds, ...seedItemIds];
  const auditWhere: Prisma.AuditLogWhereInput = {
    OR: [
      ...(seedEntityIds.length ? [{ entityId: { in: seedEntityIds } }] : []),
      ...(seedPurchaseOrderIds.length ? [{ entityId: { in: seedPurchaseOrderIds } }] : []),
      ...(seedWorkOrderIds.length ? [{ entityId: { in: seedWorkOrderIds } }] : []),
    ],
  };
  if (auditWhere.OR?.length) {
    await purge("AuditLog", auditWhere, "auditLog", counts);
  }

  if (seedItemIds.length) {
    await purge("Item", { id: { in: seedItemIds } }, "item", counts);
  }
  if (seedSupplierIds.length) {
    await purge("Supplier", { id: { in: seedSupplierIds } }, "supplier", counts);
  }

  for (const typeId of SEED_SUPPLIER_TYPE_IDS) {
    const remaining = await prisma.supplier.count({ where: { typeId } });
    if (remaining > 0) continue;
    const exists = await prisma.supplierType.count({ where: { id: typeId } });
    if (!exists) continue;
    counts[`SupplierType(${typeId})`] = exists;
    if (EXECUTE) {
      await prisma.supplierType.deleteMany({ where: { id: typeId } });
      console.log(`  deleted SupplierType(${typeId}): ${exists}`);
    } else {
      console.log(`  would delete SupplierType(${typeId}): ${exists}`);
    }
  }

  if (EXECUTE) {
    const docTypes = ["PO", "GRN", "WO", "ADJ", "RET", "ISSUE", "RECEIPT"] as const;
    for (const docType of docTypes) {
      const config = await prisma.docNumberConfig.findUnique({ where: { docType } });
      if (!config) continue;
      const remaining = await prisma.documentNumber.count({ where: { docType } });
      if (remaining === 0) {
        await prisma.docNumberConfig.update({
          where: { docType },
          data: { lastNumber: 0 },
        });
      }
    }
    console.log("\nDocNumberConfig counters reset where no issued numbers remain.");
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`\n${EXECUTE ? "Unseed complete" : "Dry-run complete"} — ${total} row(s) affected.`);
  if (!EXECUTE) {
    console.log("Re-run with: pnpm -F @elorae/db unseed -- --execute");
  } else {
    console.log("Preserved: users, accounts, sessions, RBAC, system settings, Pantone, Jubelio, and non-seed master data.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
