/**
 * Seed DEMO fixtures for lead-time A/B/C video recordings (local only).
 *
 * Idempotent. Creates/updates:
 * - English SOP instructions on ACC process templates
 * - DEMO-FAB fabric supplier with "SOP Pengadaan Kain Baru" chain
 * - DEMO-CMT tailor vendor with "SOP Produksi CMT (dengan sample)" chain
 * - Ensures seed suppliers SUP0001 / SUP0003 are ACTIVE (handy fallbacks)
 * - Demo notes item tags via supplier names only (reuses existing FAB/FG SKUs)
 *
 * Run: pnpm -F @elorae/db exec tsx prisma/seed-lead-time-demo.ts
 */
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client";
import { getDatabaseUrl } from "../src/db-connection";
import { loadDbEnv } from "../src/load-env";
import { seedProcessTemplates } from "./seed-process-templates";
import { seedChainTemplates } from "./seed-chain-templates";

const ACC_SOP_INSTRUCTIONS: Record<string, string> = {
  "ACC WARNA":
    "Review lab dip / matching sample against brand standard. Approve only when shade and hand-feel match. Reject returns to matching.",
  "ACC SABLON":
    "Approve print placement, color, and registration on the sablon sample before bulk production.",
  "ACC SAMPLE PRODUKSI":
    "Approve the production sample (fit, construction, finishing) before releasing bulk cutting/sewing.",
};

async function applySopByName(
  prisma: PrismaClient,
  supplierId: string,
  sopName: string,
): Promise<number> {
  const tmpl = await prisma.chainTemplate.findUnique({
    where: { name: sopName },
    include: {
      steps: { orderBy: { sequence: "asc" } },
    },
  });
  if (!tmpl || tmpl.steps.length === 0) {
    throw new Error(`ChainTemplate "${sopName}" missing or empty`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.supplierProcess.deleteMany({ where: { supplierId } });
    for (let i = 0; i < tmpl.steps.length; i++) {
      await tx.supplierProcess.create({
        data: {
          supplierId,
          processTemplateId: tmpl.steps[i].processTemplateId,
          sequence: i + 1,
          notes: tmpl.steps[i].notes,
        },
      });
    }
  });
  return tmpl.steps.length;
}

async function ensureSupplier(
  prisma: PrismaClient,
  opts: {
    code: string;
    name: string;
    typeCode: "FABRIC" | "TAILOR";
    email: string;
    phone: string;
    address: string;
  },
) {
  const type = await prisma.supplierType.findUnique({
    where: { code: opts.typeCode },
  });
  if (!type) throw new Error(`SupplierType ${opts.typeCode} not found`);

  const admin = await prisma.user.findFirst({
    where: { email: "admin@elorae.com" },
    select: { id: true },
  });

  return prisma.supplier.upsert({
    where: { code: opts.code },
    update: {
      name: opts.name,
      typeId: type.id,
      isActive: true,
      status: "ACTIVE",
      approvedAt: new Date(),
      approvedById: admin?.id ?? undefined,
      email: opts.email,
      phone: opts.phone,
      address: opts.address,
    },
    create: {
      code: opts.code,
      name: opts.name,
      typeId: type.id,
      isActive: true,
      status: "ACTIVE",
      approvedAt: new Date(),
      approvedById: admin?.id ?? undefined,
      email: opts.email,
      phone: opts.phone,
      address: opts.address,
      bankName: "BCA",
      bankAccountName: opts.name,
    },
  });
}

async function activateSeedFallbacks(prisma: PrismaClient) {
  const admin = await prisma.user.findFirst({
    where: { email: "admin@elorae.com" },
    select: { id: true },
  });
  for (const code of ["SUP0001", "SUP0003"]) {
    await prisma.supplier.updateMany({
      where: { code },
      data: {
        isActive: true,
        status: "ACTIVE",
        approvedAt: new Date(),
        approvedById: admin?.id ?? undefined,
      },
    });
  }
}

async function ensureLeadTimePermissions(prisma: PrismaClient) {
  const adminRole = await prisma.roleDefinition.findFirst({
    where: { name: "ADMIN" },
    select: { id: true },
  });
  if (!adminRole) return { linked: 0 };

  let linked = 0;
  for (const code of ["lead_time:view", "lead_time:manage"]) {
    let perm = await prisma.permission.findUnique({ where: { code } });
    if (!perm) {
      const [moduleName, action] = code.split(":");
      perm = await prisma.permission.create({
        data: {
          code,
          module: moduleName,
          action,
          description:
            code === "lead_time:view"
              ? "View process library and supplier chains"
              : "Manage process library and supplier chains",
        },
      });
    }
    const existing = await prisma.rolePermission.findFirst({
      where: { roleId: adminRole.id, permissionId: perm.id },
    });
    if (!existing) {
      await prisma.rolePermission.create({
        data: { roleId: adminRole.id, permissionId: perm.id },
      });
      linked += 1;
    }
  }
  return { linked };
}

async function printChecklist(prisma: PrismaClient) {
  const demoFab = await prisma.supplier.findUnique({
    where: { code: "DEMO-FAB" },
    include: {
      processChain: {
        orderBy: { sequence: "asc" },
        include: { processTemplate: { select: { name: true, isApproval: true } } },
      },
    },
  });
  const demoCmt = await prisma.supplier.findUnique({
    where: { code: "DEMO-CMT" },
    include: {
      processChain: {
        orderBy: { sequence: "asc" },
        include: { processTemplate: { select: { name: true, isApproval: true } } },
      },
    },
  });
  const fabric = await prisma.item.findFirst({
    where: { sku: "FAB-COT-001" },
    select: { sku: true, nameEn: true },
  });
  const fg = await prisma.item.findFirst({
    where: { sku: "FG-SHIRT-001" },
    select: { sku: true, nameEn: true },
  });

  console.log("\n=== Lead Time demo prep ready ===");
  console.log("Login: admin@elorae.com / admin123");
  console.log("App:   http://localhost:3000");
  console.log("\nVideo A — Procurement");
  console.log("  Supplier: DEMO-FAB —", demoFab?.name);
  console.log(
    "  Chain:",
    demoFab?.processChain.map((s) => s.processTemplate.name).join(" → "),
  );
  console.log("  PO line item:", fabric?.sku, fabric?.nameEn);
  console.log("  Tip: create PO during recording; optionally create DRAFT WO");
  console.log("       linked to that PO (vendor DEMO-CMT) before GRN for MATERIAL_ARRIVED.");
  console.log("\nVideo B — Production");
  console.log("  Vendor: DEMO-CMT —", demoCmt?.name);
  console.log(
    "  Chain:",
    demoCmt?.processChain.map((s) => s.processTemplate.name).join(" → "),
  );
  console.log("  FG item:", fg?.sku, fg?.nameEn);
  console.log("  plannedQty tip: 15000 pcs → PROSES PRODUKSI BATCH_CEIL = 60 days");
  console.log("\nVideo C — Full story");
  console.log("  Use DEMO-FAB (PO) then DEMO-CMT (WO), same items as above.");
  console.log("================================\n");
}

export async function seedLeadTimeDemo(prisma: PrismaClient) {
  await seedProcessTemplates(prisma);
  await seedChainTemplates(prisma);

  for (const [name, text] of Object.entries(ACC_SOP_INSTRUCTIONS)) {
    await prisma.processTemplate.updateMany({
      where: { name },
      data: { isApproval: true, sopInstructions: text },
    });
  }

  await activateSeedFallbacks(prisma);
  await ensureLeadTimePermissions(prisma);

  // Ensure SUP0001 keeps a fabric SOP if empty (fallback for explorers)
  const kain = await prisma.supplier.findUnique({ where: { code: "SUP0001" } });
  if (kain) {
    const n = await prisma.supplierProcess.count({
      where: { supplierId: kain.id },
    });
    if (n === 0) {
      await applySopByName(prisma, kain.id, "SOP Pengadaan Kain Baru");
    }
  }
  const budi = await prisma.supplier.findUnique({ where: { code: "SUP0003" } });
  if (budi) {
    await applySopByName(prisma, budi.id, "SOP Produksi CMT (dengan sample)");
  }

  const demoFab = await ensureSupplier(prisma, {
    code: "DEMO-FAB",
    name: "DEMO Fabric Mill (Lead Time)",
    typeCode: "FABRIC",
    email: "demo-fab@elorae.local",
    phone: "+62 811 0000 001",
    address: "Demo — fabric procurement chain",
  });
  const fabSteps = await applySopByName(
    prisma,
    demoFab.id,
    "SOP Pengadaan Kain Baru",
  );

  const demoCmt = await ensureSupplier(prisma, {
    code: "DEMO-CMT",
    name: "DEMO CMT Vendor (Lead Time)",
    typeCode: "TAILOR",
    email: "demo-cmt@elorae.local",
    phone: "+62 811 0000 002",
    address: "Demo — CMT production chain with ACC",
  });
  const cmtSteps = await applySopByName(
    prisma,
    demoCmt.id,
    "SOP Produksi CMT (dengan sample)",
  );

  return {
    demoFab: demoFab.code,
    fabSteps,
    demoCmt: demoCmt.code,
    cmtSteps,
  };
}

async function main() {
  loadDbEnv();
  const databaseUrl = getDatabaseUrl() || process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "DATABASE_URL is not set. Add it to apps/web/.env (or packages/db/.env).",
    );
    process.exit(1);
  }
  const adapter = new PrismaMariaDb(databaseUrl);
  const prisma = new PrismaClient({ adapter });
  try {
    const result = await seedLeadTimeDemo(prisma);
    console.log("Seeded lead-time demo:", result);
    await printChecklist(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].replace(/\\/g, "/").endsWith("seed-lead-time-demo.ts");

if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
