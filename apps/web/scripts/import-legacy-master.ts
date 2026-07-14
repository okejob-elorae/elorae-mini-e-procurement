/**
 * Legacy MASTER → Item import (Phase A: catalog / stubs).
 *
 * Pure parse/classify lives in `scripts/legacy-master/`.
 * This CLI lives under apps/web so `@elorae/db` + `xlsx` resolve.
 *
 * Usage (from apps/web):
 *   pnpm legacy:master
 *   pnpm legacy:master -- --excel "../../PRODUKSI ELORAE LAURA.xlsx"
 *   pnpm legacy:master -- --apply-materials --confirm-prod-writes
 *   pnpm legacy:master -- --apply-fg-stubs --confirm-prod-writes
 *
 * Safety:
 *   - Dry-run by default (never writes).
 *   - --apply-* against port 3306/3307 (prod tunnel) REQUIRES --confirm-prod-writes.
 *   - Existing SKUs are never updated (name/type mismatches reported only).
 *   - FG stubs are created isActive=false with a LEGACY_MASTER_STUB description.
 *   - No ConsumptionRule / stock qty is written here.
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import type { ItemType, PrismaClient } from "@elorae/db";
import {
  decideMatch,
  type ClassifiedMasterRow,
  type MatchStatus,
} from "../../../scripts/legacy-master/classify";
import {
  manifestCsv,
  parseMasterWorkbook,
  type ParseMasterResult,
} from "../../../scripts/legacy-master/parse-master";

export type ApplyDecision =
  | "WOULD_CREATE_MATERIAL"
  | "WOULD_CREATE_FG_STUB"
  | "CREATED_MATERIAL"
  | "CREATED_FG_STUB"
  | "SKIP_EXISTS"
  | "SKIP_FILTER"
  | "SKIP_EMPTY"
  | "SKIP_MISSING_UOM"
  | "ERROR";

export type ManifestRow = ClassifiedMasterRow & {
  matchStatus: MatchStatus;
  existingItemId: string | null;
  existingType: string | null;
  existingNameId: string | null;
  existingIsActive: boolean | null;
  nameMismatch: boolean;
  typeMismatch: boolean;
  applyDecision: ApplyDecision;
  uomCode: string | null;
  error: string | null;
};

type Args = {
  excelPath: string;
  outputPath: string;
  applyMaterials: boolean;
  applyFgStubs: boolean;
  confirmProdWrites: boolean;
  parseOnly: boolean;
  help: boolean;
};

const LEGACY_STUB_PREFIX = "LEGACY_MASTER_STUB";
const LEGACY_MATERIAL_PREFIX = "LEGACY_MASTER";

/** Map Excel SATUAN → ERP UOM.code. YRD shares MTR if YRD not seeded. */
const SATUAN_TO_UOM: Record<string, string[]> = {
  PCS: ["PCS"],
  YRD: ["YRD", "MTR"],
  MTR: ["MTR"],
  KG: ["KG"],
};

function parseArgs(argv: string[]): Args {
  let excelPath = path.resolve(__dirname, "../../../PRODUKSI ELORAE LAURA.xlsx");
  let outputPath = path.resolve(process.cwd(), "legacy-master-manifest.csv");
  let applyMaterials = false;
  let applyFgStubs = false;
  let confirmProdWrites = false;
  let parseOnly = false;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--apply-materials") applyMaterials = true;
    else if (arg === "--apply-fg-stubs") applyFgStubs = true;
    else if (arg === "--confirm-prod-writes") confirmProdWrites = true;
    else if (arg === "--parse-only") parseOnly = true;
    else if (arg === "--excel" && argv[i + 1]) excelPath = path.resolve(argv[++i]!);
    else if (arg === "--output" && argv[i + 1]) outputPath = path.resolve(argv[++i]!);
  }

  return {
    excelPath,
    outputPath,
    applyMaterials,
    applyFgStubs,
    confirmProdWrites,
    parseOnly,
    help,
  };
}

function printHelp(): void {
  console.log(`Legacy MASTER → Item import

Options:
  --excel <path>              Workbook path (default: repo-root PRODUKSI ELORAE LAURA.xlsx)
  --output <path>             Manifest CSV (default: ./legacy-master-manifest.csv)
  --apply-materials           CREATE missing ACCESSORIES + FABRIC items
  --apply-fg-stubs            CREATE missing FINISHED_GOOD stubs (isActive=false)
  --confirm-prod-writes       Required when applying against port 3306/3307 (prod tunnel)
  --parse-only                Classify Excel only (no DB). Useful when DATABASE_URL is down
  --help                      Show this help

Default is dry-run (reconcile + CSV only). Existing SKUs are never updated.
`);
}

function databaseLooksLikeProdTunnel(url: string): boolean {
  return /:(3306|3307)(\/|$)/.test(url);
}

function databaseLooksLikeLocalTestbed(url: string): boolean {
  return /:3308(\/|$)/.test(url);
}

function assertApplyAllowed(url: string, confirmProdWrites: boolean): void {
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  if (databaseLooksLikeLocalTestbed(url)) return;
  if (databaseLooksLikeProdTunnel(url)) {
    if (!confirmProdWrites) {
      throw new Error(
        "Refusing --apply-*: DATABASE_URL looks like the prod tunnel (port 3306 or 3307). " +
          "Re-run with --confirm-prod-writes after reviewing the dry-run manifest, " +
          "or point DATABASE_URL at the local test bed (:3308).",
      );
    }
    console.warn(
      "WARNING: applying writes against a prod-tunnel-looking DATABASE_URL (3306/3307).",
    );
    return;
  }
  if (!confirmProdWrites) {
    throw new Error(
      "Refusing --apply-*: DATABASE_URL is not the local test bed (:3308). " +
        "Pass --confirm-prod-writes to proceed deliberately.",
    );
  }
}

function buildDescription(row: ClassifiedMasterRow): string {
  const parts =
    row.proposedAction === "CREATE_FG_STUB"
      ? [LEGACY_STUB_PREFIX, `HPP=${row.hpp}`, `excelRow=${row.excelRow}`]
      : [LEGACY_MATERIAL_PREFIX, `HPP=${row.hpp}`, `excelRow=${row.excelRow}`];
  if (row.size) parts.push(`size=${row.size}`);
  if (row.parentArtikel) parts.push(`parent=${row.parentArtikel}`);
  return parts.join(" | ");
}

async function resolveUomId(
  prisma: PrismaClient,
  satuan: string,
  cache: Map<string, { id: string; code: string } | null>,
): Promise<{ uomId: string | null; uomCode: string | null }> {
  const key = satuan.trim().toUpperCase() || "PCS";
  if (cache.has(key)) {
    const hit = cache.get(key) ?? null;
    return hit ? { uomId: hit.id, uomCode: hit.code } : { uomId: null, uomCode: null };
  }
  const candidates = SATUAN_TO_UOM[key] ?? [key];
  for (const code of candidates) {
    const uom = await prisma.uOM.findUnique({ where: { code } });
    if (uom) {
      cache.set(key, { id: uom.id, code: uom.code });
      return { uomId: uom.id, uomCode: uom.code };
    }
  }
  cache.set(key, null);
  return { uomId: null, uomCode: null };
}

async function createItemFromRow(
  prisma: PrismaClient,
  row: ClassifiedMasterRow,
  uomId: string,
  asFgStub: boolean,
): Promise<string> {
  const type: ItemType = row.proposedType as ItemType;
  const isActive = asFgStub ? false : true;
  const description = buildDescription(row);

  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.item.create({
      data: {
        sku: row.sku,
        nameId: row.name,
        nameEn: row.name,
        description,
        type,
        uomId,
        variants: [],
        isActive,
        sellingPrice: null,
        source: "ERP",
      },
    });
    await tx.inventoryValue.create({
      data: {
        itemId: created.id,
        variantSku: null,
        qtyOnHand: 0,
        avgCost: row.hpp,
        totalValue: 0,
        reservedQty: 0,
      },
    });
    return created;
  });

  return item.id;
}

function renderProgress(done: number, total: number, created: number, skipped: number, errors: number): void {
  const width = 28;
  const ratio = total === 0 ? 1 : done / total;
  const filled = Math.round(ratio * width);
  const bar = `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
  const pct = Math.round(ratio * 100).toString().padStart(3, " ");
  process.stdout.write(
    `\r  [${bar}] ${pct}%  ${done}/${total}  created=${created} skip=${skipped} err=${errors}   `,
  );
  if (done >= total) process.stdout.write("\n");
}

export async function reconcileAndMaybeApply(
  prisma: PrismaClient,
  parsed: ParseMasterResult,
  opts: {
    applyMaterials: boolean;
    applyFgStubs: boolean;
  },
): Promise<{ rows: ManifestRow[]; createdMaterials: number; createdFgStubs: number }> {
  const skus = parsed.rows.map((r) => r.sku).filter(Boolean);
  const existing = await prisma.item.findMany({
    where: { sku: { in: skus } },
    select: { id: true, sku: true, type: true, nameId: true, isActive: true },
  });
  const bySku = new Map(existing.map((e) => [e.sku, e]));
  const uomCache = new Map<string, { id: string; code: string } | null>();

  let createdMaterials = 0;
  let createdFgStubs = 0;
  let skipped = 0;
  let errors = 0;
  const out: ManifestRow[] = [];
  const total = parsed.rows.length;
  const applying = opts.applyMaterials || opts.applyFgStubs;

  if (applying) {
    console.log(`Processing ${total} MASTER rows…`);
    renderProgress(0, total, 0, 0, 0);
  }

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i]!;
    const match = decideMatch(row, bySku.get(row.sku) ?? null);
    const { uomId, uomCode } = await resolveUomId(prisma, row.satuan, uomCache);

    let applyDecision: ApplyDecision = "SKIP_FILTER";
    let error: string | null = null;

    if (row.proposedAction === "SKIP_EMPTY") {
      applyDecision = "SKIP_EMPTY";
      skipped += 1;
    } else if (match.matchStatus !== "MISSING") {
      applyDecision = "SKIP_EXISTS";
      skipped += 1;
    } else if (!uomId) {
      applyDecision = "SKIP_MISSING_UOM";
      error = `No UOM for SATUAN=${row.satuan || "(empty)"}`;
      errors += 1;
    } else if (row.proposedAction === "CREATE_MATERIAL") {
      if (opts.applyMaterials) {
        try {
          await createItemFromRow(prisma, row, uomId, false);
          applyDecision = "CREATED_MATERIAL";
          createdMaterials += 1;
        } catch (e) {
          applyDecision = "ERROR";
          error = e instanceof Error ? e.message : String(e);
          errors += 1;
        }
      } else {
        applyDecision = "WOULD_CREATE_MATERIAL";
      }
    } else if (row.proposedAction === "CREATE_FG_STUB") {
      if (opts.applyFgStubs) {
        try {
          await createItemFromRow(prisma, row, uomId, true);
          applyDecision = "CREATED_FG_STUB";
          createdFgStubs += 1;
        } catch (e) {
          applyDecision = "ERROR";
          error = e instanceof Error ? e.message : String(e);
          errors += 1;
        }
      } else {
        applyDecision = "WOULD_CREATE_FG_STUB";
      }
    } else {
      skipped += 1;
    }

    out.push({
      ...row,
      ...match,
      applyDecision,
      uomCode,
      error,
    });

    if (applying) {
      renderProgress(
        i + 1,
        total,
        createdMaterials + createdFgStubs,
        skipped,
        errors,
      );
    }
  }

  return { rows: out, createdMaterials, createdFgStubs };
}

function countBy<T extends string>(
  rows: ManifestRow[],
  key: (r: ManifestRow) => T,
): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r);
    acc[k] = (acc[k] ?? 0) + 1;
  }
  return acc;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.parseOnly && (args.applyMaterials || args.applyFgStubs)) {
    console.error("Cannot combine --parse-only with --apply-*");
    process.exit(1);
  }

  const applying = args.applyMaterials || args.applyFgStubs;
  if (applying) {
    if (!process.env.DATABASE_URL) {
      console.error("DATABASE_URL is not set. Configure apps/web/.env first.");
      process.exit(1);
    }
    assertApplyAllowed(process.env.DATABASE_URL, args.confirmProdWrites);
  }

  console.log(`Excel:     ${args.excelPath}`);
  console.log(`Output:    ${args.outputPath}`);
  console.log(
    `Mode:      ${
      args.parseOnly ? "PARSE-ONLY" : applying ? "APPLY" : "DRY-RUN"
    }` +
      (args.applyMaterials ? " [materials]" : "") +
      (args.applyFgStubs ? " [fg-stubs]" : ""),
  );

  const parsed = parseMasterWorkbook(args.excelPath);
  console.log(
    `MASTER:    ${parsed.summary.total} rows ` +
      `(ACC ${parsed.summary.accessories}, FAB ${parsed.summary.fabric}, FG ${parsed.summary.finishedGood})`,
  );

  if (args.parseOnly) {
    const rows = parsed.rows.map((row) => ({
      ...row,
      matchStatus: "MISSING",
      existingItemId: null,
      existingType: null,
      existingNameId: null,
      existingIsActive: null,
      nameMismatch: false,
      typeMismatch: false,
      applyDecision:
        row.proposedAction === "CREATE_MATERIAL"
          ? "WOULD_CREATE_MATERIAL"
          : row.proposedAction === "CREATE_FG_STUB"
            ? "WOULD_CREATE_FG_STUB"
            : "SKIP_EMPTY",
      uomCode: null,
      error: null,
    }));
    fs.writeFileSync(args.outputPath, manifestCsv(rows), "utf8");
    console.log("(parse-only — no DB contact)");
    console.log(`Manifest: ${args.outputPath}`);
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Configure apps/web/.env first.");
    process.exit(1);
  }

  console.log(
    `DB host:   ${process.env.DATABASE_URL.replace(/:[^:@/]+@/, ":****@").slice(0, 80)}…`,
  );

  const { prisma } = await import("@elorae/db");

  try {
    const { rows, createdMaterials, createdFgStubs } = await reconcileAndMaybeApply(
      prisma,
      parsed,
      {
        applyMaterials: args.applyMaterials,
        applyFgStubs: args.applyFgStubs,
      },
    );

    fs.writeFileSync(args.outputPath, manifestCsv(rows), "utf8");

    const byMatch = countBy(rows, (r) => r.matchStatus);
    const byDecision = countBy(rows, (r) => r.applyDecision);

    console.log("");
    console.log("=== Reconcile summary ===");
    for (const [k, v] of Object.entries(byMatch).sort()) console.log(`  match ${k}: ${v}`);
    console.log("=== Apply decisions ===");
    for (const [k, v] of Object.entries(byDecision).sort()) console.log(`  ${k}: ${v}`);
    if (applying) {
      console.log(`Created materials: ${createdMaterials}`);
      console.log(`Created FG stubs:  ${createdFgStubs}`);
    } else {
      console.log("(dry-run — no Item rows written)");
    }
    console.log(`Manifest: ${args.outputPath}`);

    const missingUom = rows.filter((r) => r.applyDecision === "SKIP_MISSING_UOM");
    if (missingUom.length) {
      console.log(`\nMissing UOM (${missingUom.length}):`);
      for (const r of missingUom.slice(0, 15)) {
        console.log(`  row ${r.excelRow} sku=${r.sku} satuan=${r.satuan}`);
      }
    }

    const mismatches = rows.filter(
      (r) =>
        r.matchStatus === "EXISTS_NAME_MISMATCH" ||
        r.matchStatus === "EXISTS_TYPE_MISMATCH" ||
        r.matchStatus === "EXISTS_BOTH_MISMATCH",
    );
    if (mismatches.length) {
      console.log(`\nExisting SKU mismatches (${mismatches.length}) — not updated:`);
      for (const r of mismatches.slice(0, 15)) {
        console.log(
          `  ${r.sku}: excel type=${r.proposedType} name=${JSON.stringify(r.name)}` +
            ` → db type=${r.existingType} name=${JSON.stringify(r.existingNameId)}`,
        );
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
