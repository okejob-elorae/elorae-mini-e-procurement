/**
 * Seed Pantone TCX catalog from prisma/pantone-colors.seed.json
 *
 * Run: pnpm -F @elorae/db seed:pantone
 */
import fs from "fs";
import path from "path";
import type { PrismaClient } from "../generated/prisma/client";
import { classifyColor } from "../src/pantone/classify";

export type PantoneSeedEntry = {
  tcx: string;
  name: string;
  hex: string;
  groupName?: string;
  bookSection?: number;
  bookPage?: number;
  bookColumn?: number;
  bookRow?: number;
};

const SEED_PATH = path.join(process.cwd(), "prisma/pantone-colors.seed.json");

function bookFields(entry: PantoneSeedEntry) {
  if (
    entry.bookSection == null ||
    entry.bookPage == null ||
    entry.bookColumn == null ||
    entry.bookRow == null
  ) {
    return {
      bookSection: null,
      bookPage: null,
      bookColumn: null,
      bookRow: null,
    };
  }
  return {
    bookSection: entry.bookSection,
    bookPage: entry.bookPage,
    bookColumn: entry.bookColumn,
    bookRow: entry.bookRow,
  };
}

export async function seedPantoneColors(prisma: PrismaClient): Promise<void> {
  if (!fs.existsSync(SEED_PATH)) {
    console.warn(`Skipping Pantone seed: ${SEED_PATH} not found.`);
    return;
  }

  const catalog = JSON.parse(fs.readFileSync(SEED_PATH, "utf8")) as PantoneSeedEntry[];
  const withBook = catalog.filter((e) => e.bookPage != null).length;
  console.log(`Seeding ${catalog.length} Pantone TCX colors (${withBook} with fan-deck position)...`);

  const batchSize = 100;
  for (let i = 0; i < catalog.length; i += batchSize) {
    const batch = catalog.slice(i, i + batchSize);
    await Promise.all(
      batch.map((entry) => {
        const classified = classifyColor(entry.hex, entry.tcx);
        const data = {
          name: entry.name,
          hex: entry.hex,
          rgbR: classified.rgbR,
          rgbG: classified.rgbG,
          rgbB: classified.rgbB,
          groupName: entry.groupName ?? classified.groupName,
          filterTags: classified.filterTags,
          labL: classified.labL,
          labA: classified.labA,
          labB: classified.labB,
          ...bookFields(entry),
        };
        return prisma.pantoneColor.upsert({
          where: { tcx: entry.tcx },
          update: data,
          create: { tcx: entry.tcx, ...data },
        });
      })
    );
  }

  console.log(`Pantone TCX catalog OK (${catalog.length} colors)`);
}

if (require.main === module) {
  void (async () => {
    const { existsSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { config: loadEnv } = await import("dotenv");
    const { PrismaMariaDb } = await import("@prisma/adapter-mariadb");
    const { PrismaClient } = await import("../generated/prisma/client");
    const { getDatabaseUrl } = await import("../src/db-connection");

    const here = dirname(__filename);
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
    try {
      await seedPantoneColors(prisma);
    } finally {
      await prisma.$disconnect();
    }
  })();
}
