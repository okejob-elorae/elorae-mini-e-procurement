/**
 * Dry-run: HPP / HPP (2) → proposed FG Item price updates (no writes).
 *
 * Matches ARTIKEL to existing Item.sku. Outputs proposed sellingPrice + HPP cost.
 *
 * Usage (from apps/web):
 *   pnpm legacy:hpp:dry-run
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";
import { writeCsv } from "../../../scripts/legacy-master/csv-util";

const excelPath = path.resolve(__dirname, "../../../PRODUKSI ELORAE LAURA.xlsx");
const outPath = path.resolve(
  __dirname,
  "../../../scripts/legacy-master/legacy-hpp-enrichment-dry-run.csv",
);

function trim(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function resolveSheet(wb: XLSX.WorkBook, wanted: string): string | null {
  return (
    wb.SheetNames.find((n) => n === wanted) ??
    wb.SheetNames.find((n) => n.trim() === wanted.trim()) ??
    null
  );
}

type HppRow = {
  sourceSheet: string;
  excelRow: number;
  artikel: string;
  hpp: number | null;
  hppPjk: number | null;
  hrgJual: number | null;
};

function parseHppSheet(wb: XLSX.WorkBook, sheetWanted: string): HppRow[] {
  const sheetName = resolveSheet(wb, sheetWanted);
  if (!sheetName) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName]!, {
    header: 1,
    defval: null,
    raw: true,
  });
  if (!rows.length) return [];
  const header = (rows[0] ?? []).map((h) => trim(h).toUpperCase());
  const artikelCol = header.indexOf("ARTIKEL");
  const hppCol = header.indexOf("HPP");
  const hppPjkCol = header.indexOf("HPP PJK");
  const jualCol = header.indexOf("HRG JUAL");
  if (artikelCol < 0) {
    console.warn(`No ARTIKEL on ${sheetName}`);
    return [];
  }

  const out: HppRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const artikel = trim(r[artikelCol]);
    if (!artikel || !/^\d{8}[A-Z]/i.test(artikel)) continue;
    out.push({
      sourceSheet: sheetName.trim(),
      excelRow: i + 1,
      artikel: artikel.toUpperCase(),
      hpp: hppCol >= 0 ? num(r[hppCol]) : null,
      hppPjk: hppPjkCol >= 0 ? num(r[hppPjkCol]) : null,
      hrgJual: jualCol >= 0 ? num(r[jualCol]) : null,
    });
  }
  return out;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const wb = XLSX.read(fs.readFileSync(excelPath), { type: "buffer" });
  const excelRows = [...parseHppSheet(wb, "HPP"), ...parseHppSheet(wb, "HPP (2)")];

  // Prefer HPP sheet over HPP (2) when duplicate artikel
  const byArtikel = new Map<string, HppRow>();
  for (const r of excelRows) {
    const prev = byArtikel.get(r.artikel);
    if (!prev || (prev.sourceSheet !== "HPP" && r.sourceSheet === "HPP")) {
      byArtikel.set(r.artikel, r);
    }
  }

  const { prisma } = await import("@elorae/db");
  const skus = [...byArtikel.keys()];
  const items = await prisma.item.findMany({
    where: { sku: { in: skus } },
    select: {
      id: true,
      sku: true,
      nameId: true,
      type: true,
      isActive: true,
      sellingPrice: true,
      description: true,
      inventoryValues: {
        where: { variantSku: null },
        select: { avgCost: true, qtyOnHand: true },
        take: 1,
      },
    },
  });
  const bySku = new Map(items.map((i) => [i.sku, i]));

  const out = [...byArtikel.values()]
    .sort((a, b) => a.artikel.localeCompare(b.artikel))
    .map((r) => {
      const item = bySku.get(r.artikel);
      const currentSell = item?.sellingPrice != null ? Number(item.sellingPrice) : null;
      const currentCost =
        item?.inventoryValues[0]?.avgCost != null
          ? Number(item.inventoryValues[0].avgCost)
          : null;
      const proposedSell = r.hrgJual;
      const proposedCost = r.hppPjk ?? r.hpp;

      let decision = "SKIP_NO_ITEM";
      if (!item) decision = "MISSING_ITEM";
      else if (proposedSell == null && proposedCost == null) decision = "NO_PRICE_IN_EXCEL";
      else if (
        currentSell != null &&
        proposedSell != null &&
        Math.abs(currentSell - proposedSell) < 0.01 &&
        currentCost != null &&
        proposedCost != null &&
        Math.abs(currentCost - proposedCost) < 0.01
      ) {
        decision = "ALREADY_MATCHES";
      } else decision = "WOULD_UPDATE";

      return {
        artikel: r.artikel,
        sourceSheet: r.sourceSheet,
        excelRow: r.excelRow,
        excelHpp: r.hpp ?? "",
        excelHppPjk: r.hppPjk ?? "",
        excelHrgJual: r.hrgJual ?? "",
        erpItemId: item?.id ?? "",
        erpNameId: item?.nameId ?? "",
        erpType: item?.type ?? "",
        erpIsActive: item ? String(item.isActive) : "",
        currentSellingPrice: currentSell ?? "",
        currentAvgCost: currentCost ?? "",
        proposedSellingPrice: proposedSell ?? "",
        proposedAvgCost: proposedCost ?? "",
        decision,
        clientConfirmed: "NO",
        notes: item?.isActive === false ? "FG stub (inactive) — safe to enrich" : "",
      };
    });

  fs.writeFileSync(
    outPath,
    writeCsv(
      [
        "artikel",
        "sourceSheet",
        "excelRow",
        "excelHpp",
        "excelHppPjk",
        "excelHrgJual",
        "erpItemId",
        "erpNameId",
        "erpType",
        "erpIsActive",
        "currentSellingPrice",
        "currentAvgCost",
        "proposedSellingPrice",
        "proposedAvgCost",
        "decision",
        "clientConfirmed",
        "notes",
      ],
      out,
    ),
    "utf8",
  );

  const counts: Record<string, number> = {};
  for (const r of out) counts[r.decision] = (counts[r.decision] ?? 0) + 1;

  console.log(`HPP artikels: ${out.length}`);
  for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${k}: ${v}`);
  console.log(`Wrote: ${outPath}`);
  console.log("");
  console.log(">>> Dry-run only. Set clientConfirmed=YES on rows you approve, then ask for --apply.");
  console.log("    proposedSellingPrice ← HRG JUAL; proposedAvgCost ← HPP PJK (fallback HPP)");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
