/**
 * Seed ProcessTemplate library (Pustaka Proses) for Lead Time.
 *
 * Dedupe mapping (client raw 28 rows → 24 unique templates):
 * - Rows 2,19,26 → PROSES PRODUKSI PER_QTY 30/10000; variants 30/5000 and 50/18000 → SupplierProcess overrides
 * - Rows 15,23 → REVISI SABLON FIXED 7; variant 3 hari → override
 * - Rows 7,18 → PENGIRIMAN MATCHING WARNA exact duplicate dropped
 *
 * Run: pnpm -F @elorae/db exec tsx prisma/seed-process-templates.ts
 * Idempotent: upsert by name with update:{} so re-runs never overwrite admin edits.
 * Does NOT seed SupplierProcess rows — chains are built in Papan Supplier.
 */
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient, type LeadTimeType } from "../generated/prisma/client";
import { getDatabaseUrl } from "../src/db-connection";
import { loadDbEnv } from "../src/load-env";

const templates: Array<{
  name: string;
  leadTimeType: LeadTimeType;
  days: number;
  rateQty: number | null;
  notes: string | null;
  sortOrder: number;
}> = [
  { name: "MATCHING WARNA", leadTimeType: "FIXED", days: 10, rateQty: null, notes: null, sortOrder: 1 },
  {
    name: "PROSES PRODUKSI",
    leadTimeType: "PER_QTY",
    days: 30,
    rateQty: 10000,
    notes:
      "Per 10.000 pcs (menyesuaikan jumlah qty). Varian supplier: 30 hari/5.000 pcs, 50 hari/18.000 pcs — atur via override di Papan Supplier.",
    sortOrder: 2,
  },
  { name: "ACC WARNA", leadTimeType: "FIXED", days: 2, rateQty: null, notes: null, sortOrder: 3 },
  { name: "PENGIRIMAN KAIN", leadTimeType: "FIXED", days: 7, rateQty: null, notes: null, sortOrder: 4 },
  { name: "PENGIRIMAN KKD", leadTimeType: "FIXED", days: 7, rateQty: null, notes: null, sortOrder: 5 },
  { name: "PENGIRIMAN MATCHING", leadTimeType: "FIXED", days: 3, rateQty: null, notes: null, sortOrder: 6 },
  { name: "PENGIRIMAN MATCHING WARNA", leadTimeType: "FIXED", days: 3, rateQty: null, notes: null, sortOrder: 7 },
  { name: "PENGIRIMAN PRODUKSI", leadTimeType: "FIXED", days: 5, rateQty: null, notes: null, sortOrder: 8 },
  { name: "PENGIRIMAN SABLON", leadTimeType: "FIXED", days: 3, rateQty: null, notes: null, sortOrder: 9 },
  { name: "PROSES PENGIRIMAN", leadTimeType: "FIXED", days: 3, rateQty: null, notes: null, sortOrder: 10 },
  { name: "PROSES PILIH WARNA", leadTimeType: "FIXED", days: 1, rateQty: null, notes: null, sortOrder: 11 },
  { name: "PROSES PRODUKSI KAIN", leadTimeType: "FIXED", days: 45, rateQty: null, notes: null, sortOrder: 12 },
  { name: "PROSES PRODUKSI KKD", leadTimeType: "FIXED", days: 45, rateQty: null, notes: null, sortOrder: 13 },
  {
    name: "PROSES PRODUKSI SABLON",
    leadTimeType: "PER_QTY",
    days: 7,
    rateQty: 4000,
    notes: "Per 4.000 pcs (menyesuaikan jumlah qty)",
    sortOrder: 14,
  },
  {
    name: "REVISI SABLON",
    leadTimeType: "FIXED",
    days: 7,
    rateQty: null,
    notes: "Varian supplier: 3 hari — atur via override di Papan Supplier.",
    sortOrder: 15,
  },
  { name: "SAMPLE PRODUKSI", leadTimeType: "FIXED", days: 10, rateQty: null, notes: null, sortOrder: 16 },
  { name: "SAMPLE SABLON", leadTimeType: "FIXED", days: 7, rateQty: null, notes: null, sortOrder: 17 },
  { name: "PENGIRIMAN BARANG JADI", leadTimeType: "FIXED", days: 3, rateQty: null, notes: null, sortOrder: 18 },
  { name: "PROSES PRODUKSI ZIPPER", leadTimeType: "FIXED", days: 40, rateQty: null, notes: null, sortOrder: 19 },
  { name: "ACC SABLON", leadTimeType: "FIXED", days: 2, rateQty: null, notes: null, sortOrder: 20 },
  { name: "ACC SAMPLE PRODUKSI", leadTimeType: "FIXED", days: 2, rateQty: null, notes: null, sortOrder: 21 },
  { name: "REVISI SAMPLE PRODUKSI", leadTimeType: "FIXED", days: 10, rateQty: null, notes: null, sortOrder: 22 },
  { name: "PROSES KAIN READY", leadTimeType: "FIXED", days: 2, rateQty: null, notes: null, sortOrder: 23 },
  { name: "PROSES KAIN IMPORT", leadTimeType: "FIXED", days: 90, rateQty: null, notes: null, sortOrder: 24 },
];

const APPROVAL_PROCESS_NAMES = [
  "ACC WARNA",
  "ACC SABLON",
  "ACC SAMPLE PRODUKSI",
] as const;

export async function seedProcessTemplates(prisma: PrismaClient): Promise<number> {
  let count = 0;
  for (const t of templates) {
    await prisma.processTemplate.upsert({
      where: { name: t.name },
      update: {},
      create: {
        name: t.name,
        leadTimeType: t.leadTimeType,
        days: t.days,
        rateQty: t.rateQty,
        notes: t.notes,
        sortOrder: t.sortOrder,
        isActive: true,
      },
    });
    count += 1;
  }

  await prisma.processTemplate.updateMany({
    where: { name: { in: [...APPROVAL_PROCESS_NAMES] } },
    data: { isApproval: true },
  });

  return count;
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
    const n = await seedProcessTemplates(prisma);
    console.log(`Seeded ${n} process templates (upsert by name).`);
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].replace(/\\/g, "/").endsWith("seed-process-templates.ts");

if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
