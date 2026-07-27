/**
 * Seed provisional ChainTemplate SOPs for Lead Time.
 *
 * Idempotent: upsert by ChainTemplate.name; steps replaced on each run for that SOP.
 * Requires ProcessTemplate rows to exist (run seedProcessTemplates first).
 *
 * Run: pnpm -F @elorae/db exec tsx prisma/seed-chain-templates.ts
 */
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client";
import { getDatabaseUrl } from "../src/db-connection";
import { loadDbEnv } from "../src/load-env";

const sops: Array<{ name: string; stepNames: string[] }> = [
  {
    name: "SOP Pengadaan Kain Baru",
    stepNames: [
      "PROSES PILIH WARNA",
      "MATCHING WARNA",
      "PENGIRIMAN MATCHING",
      "ACC WARNA",
      "PROSES PRODUKSI KAIN",
      "PENGIRIMAN KAIN",
    ],
  },
  {
    name: "SOP Kain Ready Stock",
    stepNames: ["PROSES KAIN READY", "PENGIRIMAN KAIN"],
  },
  {
    name: "SOP Kain Import",
    stepNames: ["PROSES KAIN IMPORT", "PENGIRIMAN KAIN"],
  },
  {
    name: "SOP Produksi CMT (dengan sample)",
    stepNames: [
      "SAMPLE PRODUKSI",
      "ACC SAMPLE PRODUKSI",
      "PROSES PRODUKSI",
      "PENGIRIMAN BARANG JADI",
    ],
  },
  {
    name: "SOP Sablon",
    stepNames: [
      "SAMPLE SABLON",
      "ACC SABLON",
      "PROSES PRODUKSI SABLON",
      "PENGIRIMAN SABLON",
    ],
  },
  {
    name: "SOP KKD",
    stepNames: ["PROSES PRODUKSI KKD", "PENGIRIMAN KKD"],
  },
  {
    name: "SOP Zipper",
    stepNames: ["PROSES PRODUKSI ZIPPER", "PENGIRIMAN BARANG JADI"],
  },
];

export async function seedChainTemplates(prisma: PrismaClient): Promise<number> {
  let count = 0;
  for (const sop of sops) {
    const processIds: string[] = [];
    for (const stepName of sop.stepNames) {
      const pt = await prisma.processTemplate.findUnique({
        where: { name: stepName },
        select: { id: true },
      });
      if (!pt) {
        throw new Error(
          `ProcessTemplate "${stepName}" not found for SOP "${sop.name}". Seed process templates first.`
        );
      }
      processIds.push(pt.id);
    }

    const tmpl = await prisma.chainTemplate.upsert({
      where: { name: sop.name },
      update: {},
      create: {
        name: sop.name,
        isActive: true,
      },
    });

    await prisma.chainTemplateStep.deleteMany({
      where: { chainTemplateId: tmpl.id },
    });
    for (let i = 0; i < processIds.length; i++) {
      await prisma.chainTemplateStep.create({
        data: {
          chainTemplateId: tmpl.id,
          processTemplateId: processIds[i],
          sequence: i + 1,
        },
      });
    }
    count += 1;
  }
  return count;
}

async function main() {
  loadDbEnv();
  const databaseUrl = getDatabaseUrl() || process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "DATABASE_URL is not set. Add it to apps/web/.env (or packages/db/.env)."
    );
    process.exit(1);
  }
  const adapter = new PrismaMariaDb(databaseUrl);
  const prisma = new PrismaClient({ adapter });
  try {
    const n = await seedChainTemplates(prisma);
    console.log(`Seeded ${n} chain templates (upsert by name).`);
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].replace(/\\/g, "/").endsWith("seed-chain-templates.ts");

if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
