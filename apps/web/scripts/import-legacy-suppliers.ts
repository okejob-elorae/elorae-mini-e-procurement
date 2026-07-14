/**
 * Legacy supplier import — reads scripts/legacy-master/legacy-suppliers-review.csv
 *
 * Usage (from apps/web):
 *   pnpm legacy:suppliers            # dry-run vs DB
 *   pnpm legacy:suppliers -- --apply --confirm-prod-writes
 *
 * Only rows with clientConfirmed=YES are applied.
 * MERGE rows do not create suppliers — they only feed the alias map CSV.
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import type { PrismaClient } from "@elorae/db";
import { parseCsv, writeCsv, renderProgress } from "../../../scripts/legacy-master/csv-util";

const REVIEW_DEFAULT = path.resolve(
  __dirname,
  "../../../scripts/legacy-master/legacy-suppliers-review.csv",
);
const ALIAS_OUT_DEFAULT = path.resolve(
  __dirname,
  "../../../scripts/legacy-master/legacy-supplier-alias-map.csv",
);

type Args = {
  reviewPath: string;
  aliasOut: string;
  apply: boolean;
  confirmProdWrites: boolean;
  help: boolean;
};

const VALID_TYPES = new Set(["FABRIC", "ACCESSORIES", "TAILOR", "OTHER"]);
const VALID_ACTIONS = new Set(["CREATE", "MERGE", "SKIP"]);

function parseArgs(argv: string[]): Args {
  let reviewPath = REVIEW_DEFAULT;
  let aliasOut = ALIAS_OUT_DEFAULT;
  let apply = false;
  let confirmProdWrites = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--apply") apply = true;
    else if (a === "--confirm-prod-writes") confirmProdWrites = true;
    else if (a === "--review" && argv[i + 1]) reviewPath = path.resolve(argv[++i]!);
    else if (a === "--alias-out" && argv[i + 1]) aliasOut = path.resolve(argv[++i]!);
  }
  return { reviewPath, aliasOut, apply, confirmProdWrites, help };
}

function assertApplyAllowed(url: string, confirm: boolean): void {
  if (/:3308(\/|$)/.test(url)) return;
  if (/:(3306|3307)(\/|$)/.test(url)) {
    if (!confirm) {
      throw new Error(
        "Refusing --apply: prod-tunnel URL (3306/3307). Pass --confirm-prod-writes.",
      );
    }
    console.warn("WARNING: writing suppliers against prod-tunnel DATABASE_URL.");
    return;
  }
  if (!confirm) {
    throw new Error("Refusing --apply: not local testbed (:3308). Pass --confirm-prod-writes.");
  }
}

async function resolveTypeId(
  prisma: PrismaClient,
  code: string,
  cache: Map<string, string>,
): Promise<string | null> {
  if (cache.has(code)) return cache.get(code)!;
  const t = await prisma.supplierType.findUnique({ where: { code } });
  if (!t) return null;
  cache.set(code, t.id);
  return t.id;
}

function slugCode(name: string): string {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return `LEG-${base || "SUP"}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Legacy supplier import

  --review <path>           Default: scripts/legacy-master/legacy-suppliers-review.csv
  --alias-out <path>        Alias map written after run
  --apply                   Create ACTIVE suppliers for confirmed CREATE rows
  --confirm-prod-writes     Required for :3306/:3307
`);
    process.exit(0);
  }

  if (!fs.existsSync(args.reviewPath)) {
    console.error(`Review CSV missing: ${args.reviewPath}`);
    console.error("Run: pnpm legacy:suppliers:extract && pnpm legacy:suppliers:review");
    process.exit(1);
  }

  if (args.apply) {
    if (!process.env.DATABASE_URL) {
      console.error("DATABASE_URL not set");
      process.exit(1);
    }
    assertApplyAllowed(process.env.DATABASE_URL, args.confirmProdWrites);
  }

  const review = parseCsv(fs.readFileSync(args.reviewPath, "utf8"));
  console.log(`Review: ${args.reviewPath} (${review.length} rows)`);
  console.log(`Mode:   ${args.apply ? "APPLY" : "DRY-RUN"}`);

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set (needed for dry-run reconcile too)");
    process.exit(1);
  }

  const { prisma } = await import("@elorae/db");
  const typeCache = new Map<string, string>();
  const existing = await prisma.supplier.findMany({
    select: { id: true, code: true, name: true, status: true },
  });
  const byName = new Map(existing.map((s) => [s.name.trim().toLowerCase(), s]));
  const byCode = new Map(existing.map((s) => [s.code, s]));

  type ManifestRow = {
    excelName: string;
    action: string;
    canonicalName: string;
    typeCode: string;
    clientConfirmed: string;
    decision: string;
    existingCode: string;
    error: string;
  };

  const manifest: ManifestRow[] = [];
  const aliasRows: Array<Record<string, string>> = [];
  let created = 0;
  let skipped = 0;
  let errors = 0;

  // Build create set of canonical names first
  const confirmedCreates = new Map<string, (typeof review)[0]>();
  for (const r of review) {
    if (r.action === "CREATE" && r.clientConfirmed === "YES" && r.canonicalName) {
      confirmedCreates.set(r.canonicalName.toLowerCase(), r);
    }
  }

  console.log(`Processing ${review.length} review rows…`);
  renderProgress(0, review.length, `created=${created}`);

  for (let i = 0; i < review.length; i++) {
    const r = review[i]!;
    const action = (r.action || "").toUpperCase();
    const confirmed = r.clientConfirmed === "YES";
    let decision = "PENDING";
    let existingCode = "";
    let error = "";

    if (!VALID_ACTIONS.has(action)) {
      decision = "INVALID_ACTION";
      error = `action must be CREATE|MERGE|SKIP`;
      errors += 1;
    } else if (action === "SKIP") {
      decision = confirmed ? "SKIP_OK" : "SKIP_UNCONFIRMED";
      skipped += 1;
      if (confirmed) {
        aliasRows.push({
          excelName: r.excelName,
          canonicalName: "",
          supplierCode: "",
          action: "SKIP",
        });
      }
    } else if (action === "MERGE") {
      if (!r.canonicalName) {
        decision = "MERGE_MISSING_CANONICAL";
        error = "canonicalName required for MERGE";
        errors += 1;
      } else if (!confirmed) {
        decision = "MERGE_UNCONFIRMED";
        skipped += 1;
      } else {
        const hit = byName.get(r.canonicalName.toLowerCase());
        decision = hit ? "MERGE_ALIAS_READY" : "MERGE_ALIAS_PENDING_CREATE";
        existingCode = hit?.code ?? "";
        aliasRows.push({
          excelName: r.excelName,
          canonicalName: r.canonicalName,
          supplierCode: existingCode,
          action: "MERGE",
        });
      }
    } else {
      // CREATE
      if (!VALID_TYPES.has(r.typeCode)) {
        decision = "INVALID_TYPE";
        error = `typeCode must be FABRIC|ACCESSORIES|TAILOR|OTHER`;
        errors += 1;
      } else if (!r.canonicalName) {
        decision = "CREATE_MISSING_NAME";
        error = "canonicalName required";
        errors += 1;
      } else if (!confirmed) {
        decision = "CREATE_UNCONFIRMED";
        skipped += 1;
      } else {
        const hit = byName.get(r.canonicalName.toLowerCase());
        if (hit) {
          decision = "SKIP_EXISTS";
          existingCode = hit.code;
          skipped += 1;
          aliasRows.push({
            excelName: r.excelName,
            canonicalName: r.canonicalName,
            supplierCode: hit.code,
            action: "CREATE_EXISTS",
          });
        } else if (args.apply) {
          try {
            const typeId = await resolveTypeId(prisma, r.typeCode, typeCache);
            if (!typeId) {
              decision = "MISSING_TYPE";
              error = `SupplierType ${r.typeCode} not in DB`;
              errors += 1;
            } else {
              let code = slugCode(r.canonicalName);
              if (byCode.has(code)) code = `${code}-${String(created + 1).padStart(2, "0")}`;
              const row = await prisma.supplier.create({
                data: {
                  code,
                  name: r.canonicalName,
                  typeId,
                  status: "ACTIVE",
                  isActive: true,
                  approvedAt: new Date(),
                },
              });
              byName.set(row.name.toLowerCase(), row);
              byCode.set(row.code, row);
              decision = "CREATED";
              existingCode = row.code;
              created += 1;
              aliasRows.push({
                excelName: r.excelName,
                canonicalName: r.canonicalName,
                supplierCode: row.code,
                action: "CREATE",
              });
            }
          } catch (e) {
            decision = "ERROR";
            error = e instanceof Error ? e.message : String(e);
            errors += 1;
          }
        } else {
          decision = "WOULD_CREATE";
          aliasRows.push({
            excelName: r.excelName,
            canonicalName: r.canonicalName,
            supplierCode: "",
            action: "WOULD_CREATE",
          });
        }
      }
    }

    manifest.push({
      excelName: r.excelName,
      action,
      canonicalName: r.canonicalName,
      typeCode: r.typeCode,
      clientConfirmed: r.clientConfirmed,
      decision,
      existingCode,
      error,
    });
    renderProgress(i + 1, review.length, `created=${created} skip=${skipped} err=${errors}`);
  }

  // Second pass: fill MERGE alias supplierCode now that creates may have landed
  if (args.apply) {
    for (const a of aliasRows) {
      if (a.action === "MERGE" && !a.supplierCode && a.canonicalName) {
        const hit = byName.get(a.canonicalName.toLowerCase());
        if (hit) a.supplierCode = hit.code;
      }
    }
  }

  const manifestPath = path.resolve(process.cwd(), "legacy-suppliers-manifest.csv");
  fs.writeFileSync(
    manifestPath,
    writeCsv(
      [
        "excelName",
        "action",
        "canonicalName",
        "typeCode",
        "clientConfirmed",
        "decision",
        "existingCode",
        "error",
      ],
      manifest,
    ),
    "utf8",
  );
  fs.writeFileSync(
    args.aliasOut,
    writeCsv(["excelName", "canonicalName", "supplierCode", "action"], aliasRows),
    "utf8",
  );

  const counts: Record<string, number> = {};
  for (const m of manifest) counts[m.decision] = (counts[m.decision] ?? 0) + 1;

  console.log("");
  console.log("=== Decisions ===");
  for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${k}: ${v}`);
  console.log(`Created: ${created}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`Alias map: ${args.aliasOut}`);

  const unconfirmed = review.filter((r) => r.clientConfirmed !== "YES").length;
  if (unconfirmed) {
    console.log("");
    console.log(`>>> ${unconfirmed} rows still have clientConfirmed≠YES — edit the review CSV.`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
