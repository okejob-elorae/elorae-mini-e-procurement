/**
 * UMKM opening-stock reconciliation (one-time).
 *
 * Manifest: excel UMKM production qty − Shopee/TikTok SalesHistory net qty.
 *
 * Usage (from apps/web):
 *   pnpm reconcile:umkm -- --excel "../../Temp Elorae Reconciliation.xlsx"
 *   pnpm reconcile:umkm -- --excel "../../Temp Elorae Reconciliation.xlsx" --apply
 *
 * Requires DATABASE_URL (apps/web/.env).
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { writeManifestXlsx } from "../lib/reconciliation/umkm-manifest-export";
import {
  applyUmkmManifest,
  buildUmkmManifest,
  resolveScriptUserId,
} from "../lib/reconciliation/umkm-opening-stock";

function parseArgs(argv: string[]) {
  let excelPath = path.resolve(__dirname, "../../../Temp Elorae Reconciliation.xlsx");
  let outputPath: string | null = null;
  let otherSourcesPath: string | null = null;
  let apply = false;
  let userId: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--excel" && argv[i + 1]) {
      excelPath = path.resolve(argv[++i]);
    } else if (arg === "--output" && argv[i + 1]) {
      outputPath = path.resolve(argv[++i]);
    } else if (arg === "--other-sources" && argv[i + 1]) {
      otherSourcesPath = path.resolve(argv[++i]);
    } else if (arg === "--user-id" && argv[i + 1]) {
      userId = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      console.log(`UMKM opening-stock reconciliation

Options:
  --excel <path>           Excel file (default: repo root Temp Elorae Reconciliation.xlsx)
  --other-sources <dir>    Other deduction Excel files (default: repo root other-sources/)
  --output <path>          XLSX output path (default: ./umkm-reconciliation-manifest.xlsx)
  --apply                  Apply stock adjustments (idempotent doc ADJ/UMKM-OPEN/<sku>)
  --user-id <id>           Audit user for --apply (default: first active ADMIN)
  --help                   Show this help

Formula:
  impliedOnHand = excelSizeQty - salesAllocatedQty + fakeBuyCreditQty - otherDeductionQty
`);
      process.exit(0);
    }
  }

  if (!outputPath) {
    outputPath = path.resolve(process.cwd(), "umkm-reconciliation-manifest.xlsx");
  }

  if (!otherSourcesPath) {
    otherSourcesPath = path.resolve(__dirname, "../../../other-sources");
  }

  return { excelPath, outputPath, otherSourcesPath, apply, userId };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Configure apps/web/.env first.");
    process.exit(1);
  }

  const { excelPath, outputPath, otherSourcesPath, apply, userId: userIdArg } = parseArgs(
    process.argv.slice(2),
  );

  if (!fs.existsSync(excelPath)) {
    console.error(`Excel file not found: ${excelPath}`);
    process.exit(1);
  }

  const { prisma } = await import("@elorae/db");

  console.log(`Reading excel: ${excelPath}`);
  console.log(`Other sources: ${otherSourcesPath}`);
  const manifest = await buildUmkmManifest(prisma, excelPath, {
    otherSourcesDir: otherSourcesPath,
  });

  writeManifestXlsx(outputPath, manifest);

  console.log("");
  console.log("=== UMKM reconciliation manifest ===");
  console.log(`Cutoff (latest):     ${manifest.cutoff.toISOString().slice(0, 10)}`);
  console.log(`Excel max TGL:       ${manifest.excelMaxTgl?.toISOString().slice(0, 10) ?? "n/a"}`);
  console.log(`Sales max date:      ${manifest.salesMaxDate?.toISOString().slice(0, 10) ?? "n/a"}`);
  console.log(`Parent SKUs (UMKM):  ${manifest.summary.totalParentSkus}`);
  console.log(`Variant rows:        ${manifest.summary.totalVariantRows}`);
  console.log(`Mapped to ERP:       ${manifest.summary.mapped}`);
  console.log(`Unmapped:            ${manifest.summary.unmapped}`);
  console.log(`With marketplace sales: ${manifest.summary.withSales}`);
  console.log(`Negative implied:    ${manifest.summary.negativeImplied}`);
  console.log(`Applyable (delta≠0): ${manifest.summary.applyable}`);
  console.log(`Fake buy credits:    ${manifest.otherSourcesSummary.fakeBuyLineCount} lines`);
  console.log(`Other deductions:    ${manifest.otherSourcesSummary.deductionLineCount} lines`);
  console.log(`Skipped other-src:   ${manifest.otherSourcesSummary.skippedLineCount} lines`);
  console.log(`Manifest written:    ${outputPath}`);
  console.log(
    `  Sheets: Summary, Manifest (${manifest.rows.length} rows), SalesOrders (${manifest.salesOrders.length} rows), FakeBuyCredits (${manifest.fakeBuyCredits.length}), OtherDeductions (${manifest.otherDeductions.length}), OtherSourcesSkipped (${manifest.otherSourcesSkipped.length}), VariantMap (${manifest.variantMap.length})`,
  );

  if (manifest.summary.unmapped > 0) {
    console.log("\nUnmapped SKUs:");
    for (const row of manifest.rows
      .filter((r) => r.status === "UNMAPPED" || r.status === "ERP_SIZE_MISSING")
      .slice(0, 20)) {
      console.log(
        `  ${row.parentKode} → ${row.erpVariantSku}  excel_size=${row.excelSizeQty}  [${row.status}]`,
      );
    }
    if (manifest.summary.unmapped > 20) {
      console.log(`  ... and ${manifest.summary.unmapped - 20} more`);
    }
  }

  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to write stock adjustments.");
    await prisma.$disconnect();
    return;
  }

  console.log("\n⚠ Applying stock adjustments to DATABASE_URL target...");
  const effectiveUserId = userIdArg ?? (await resolveScriptUserId(prisma));
  const result = await applyUmkmManifest(prisma, manifest, effectiveUserId);

  console.log(`Applied:  ${result.applied}`);
  console.log(`Skipped:  ${result.skipped} (already applied)`);
  if (result.errors.length > 0) {
    console.log(`Errors:   ${result.errors.length}`);
    for (const e of result.errors.slice(0, 10)) {
      console.log(`  ${e.kodeBarang}: ${e.message}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
