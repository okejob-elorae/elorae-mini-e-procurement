/**
 * Production smoke fixtures — Plan Kerja 2099 + RBAC fixes for role split.
 *
 * Usage (from repo root, after packages/db is built):
 *   set SMOKE_DB_PACKAGE_ROOT=packages/db
 *   node test-run/setup-production-smoke.cjs
 *
 * Requires seed catalog: FG-SHIRT-001, FAB-COT-001, SUP0001, SUP0003, admin@elorae.com
 */
const path = require("node:path");
const { createRequire } = require("node:module");
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
if (!dbRootRaw) {
  throw new Error("SMOKE_DB_PACKAGE_ROOT is required (e.g. packages/db)");
}
const dbRoot = path.isAbsolute(dbRootRaw)
  ? dbRootRaw
  : path.resolve(__dirname, "..", dbRootRaw);

const requireFromDb = createRequire(path.join(dbRoot, "package.json"));
const bcrypt = requireFromDb("bcryptjs");
const { prisma } = require(path.join(dbRoot, "dist", "src", "index.js"));

const PLAN_YEAR = 2099;
const PLAN_NOTES = "SMOKE-PROD smoke test plan — safe to delete after run";
const ITEM_CATEGORY_CODE = "SMOKE-PROD-SHIRT";
const LEAF_CODE = "SMOKE-FG-SHIRT";
const M1_TARGET = 50;
const VARIANT_SKU = "";
const PIN = "123456";

async function ensurePurchaserApprove() {
  const perm = await prisma.permission.findUnique({
    where: { code: "purchase_orders:approve" },
  });
  if (!perm) {
    throw new Error("Permission purchase_orders:approve missing — run db seed");
  }
  const role = await prisma.roleDefinition.findUnique({
    where: { name: "PURCHASER" },
  });
  if (!role) throw new Error("PURCHASER role missing");
  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: { roleId: role.id, permissionId: perm.id },
    },
    update: {},
    create: { roleId: role.id, permissionId: perm.id },
  });
}

async function ensureProductionPin() {
  const pinHash = await bcrypt.hash(PIN, 10);
  await prisma.user.updateMany({
    where: { email: "production@elorae.com" },
    data: { pinHash },
  });
}

async function countSupplierChain(code) {
  const supplier = await prisma.supplier.findUnique({ where: { code } });
  if (!supplier) return { code, found: false, steps: 0 };
  const steps = await prisma.supplierProcess.count({
    where: { supplierId: supplier.id },
  });
  return { code, found: true, supplierId: supplier.id, steps };
}

async function ensureSmokePlan(adminId, fgItem, tailorSupplier) {
  const itemCategory = await prisma.itemCategory.upsert({
    where: { code: ITEM_CATEGORY_CODE },
    update: { name: "Smoke Prod — Shirts", isActive: true },
    create: {
      code: ITEM_CATEGORY_CODE,
      name: "Smoke Prod — Shirts",
      isActive: true,
    },
  });

  let planYear = await prisma.planYear.findUnique({
    where: { year: PLAN_YEAR },
    include: { categories: true },
  });

  if (planYear?.status === "ACTIVE") {
    const leaf = planYear.categories.find((c) => c.itemId === fgItem.id);
    if (leaf) {
      return {
        planYearId: planYear.id,
        leafCategoryId: leaf.id,
        reused: true,
        note: "Plan year 2099 already ACTIVE — skip re-seed; use existing or reopen manually",
      };
    }
  }

  if (planYear) {
    await prisma.planYear.delete({ where: { id: planYear.id } });
  }

  planYear = await prisma.planYear.create({
    data: {
      year: PLAN_YEAR,
      notes: PLAN_NOTES,
      status: "DRAFT",
      isLocked: false,
      createdById: adminId,
    },
  });

  const root = await prisma.planCategory.create({
    data: {
      planYearId: planYear.id,
      code: ITEM_CATEGORY_CODE,
      name: itemCategory.name,
      itemCategoryId: itemCategory.id,
      targetQty: M1_TARGET,
      sortOrder: 0,
    },
  });

  const leaf = await prisma.planCategory.create({
    data: {
      planYearId: planYear.id,
      parentId: root.id,
      code: LEAF_CODE,
      name: fgItem.nameId,
      itemId: fgItem.id,
      parentSharePercent: 100,
      sortOrder: 0,
    },
  });

  for (let month = 1; month <= 12; month += 1) {
    await prisma.planMonthly.create({
      data: {
        planCategoryId: leaf.id,
        month,
        targetQty: month === 1 ? M1_TARGET : 0,
        isManualOverride: true,
      },
    });
  }

  await prisma.planColorAllocation.create({
    data: {
      planCategoryId: leaf.id,
      month: 1,
      variantSku: VARIANT_SKU,
      colorLabel: "Default",
      allocatedQty: M1_TARGET,
    },
  });

  await prisma.planCmtAllocation.create({
    data: {
      planCategoryId: leaf.id,
      month: 1,
      variantSku: VARIANT_SKU,
      supplierId: tailorSupplier.id,
      allocatedQty: M1_TARGET,
    },
  });

  return {
    planYearId: planYear.id,
    leafCategoryId: leaf.id,
    reused: false,
  };
}

async function main() {
  const outboxBefore = await prisma.jubelioOutbox.count();

  const admin = await prisma.user.findUnique({
    where: { email: "admin@elorae.com" },
    select: { id: true },
  });
  if (!admin) throw new Error("admin@elorae.com missing — run db seed");

  const fgItem = await prisma.item.findUnique({
    where: { sku: "FG-SHIRT-001" },
    select: { id: true, nameId: true, sku: true },
  });
  if (!fgItem) throw new Error("FG-SHIRT-001 missing — run db seed");

  const fabricItem = await prisma.item.findUnique({
    where: { sku: "FAB-COT-001" },
    select: { id: true, sku: true },
  });
  if (!fabricItem) throw new Error("FAB-COT-001 missing — run db seed");

  const tailorSupplier = await prisma.supplier.findUnique({
    where: { code: "SUP0003" },
    select: { id: true, code: true, name: true },
  });
  if (!tailorSupplier) throw new Error("SUP0003 missing — run db seed");

  await ensurePurchaserApprove();
  await ensureProductionPin();

  const plan = await ensureSmokePlan(admin.id, fgItem, tailorSupplier);

  const chains = await Promise.all([
    countSupplierChain("SUP0001"),
    countSupplierChain("SUP0003"),
  ]);

  const outboxAfter = await prisma.jubelioOutbox.count();

  console.log(
    JSON.stringify(
      {
        planYear: PLAN_YEAR,
        plan,
        catalog: {
          finishedGood: fgItem,
          fabric: fabricItem,
          cmtVendor: tailorSupplier,
        },
        leadTimeChains: chains,
        leadTimeHint:
          chains.some((c) => c.steps === 0)
            ? "Run: pnpm -F @elorae/db exec tsx prisma/seed-lead-time-demo.ts"
            : "Chains present",
        rbac: {
          purchaserApprove: true,
          productionPin: PIN,
        },
        actors: {
          planner: "admin@elorae.com / admin123 / PIN 123456",
          purchaser: "purchaser@elorae.com / purchaser123 / PIN 123456",
          warehouse: "warehouse@elorae.com / warehouse123 / PIN 123456",
          production: "production@elorae.com / production123 / PIN 123456",
        },
        outbox: {
          before: outboxBefore,
          after: outboxAfter,
          delta: outboxAfter - outboxBefore,
        },
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
