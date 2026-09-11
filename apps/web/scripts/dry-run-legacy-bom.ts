/**
 * Dry-run BOM candidates from JAHIT KE CMT + RINCIAN HPP AKSESORIS (no writes).
 *
 * JAHIT: per-artikel accessory qty columns → qtyRequired ≈ accessoryQty / EST
 * RINCIAN: cost breakdown only (reference; not qty BOM)
 *
 * Usage (from apps/web):
 *   pnpm legacy:bom:dry-run
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";
import { writeCsv } from "../../../scripts/legacy-master/csv-util";

const excelPath = path.resolve(__dirname, "../../../PRODUKSI ELORAE LAURA.xlsx");
const outBom = path.resolve(
  __dirname,
  "../../../scripts/legacy-master/legacy-bom-dry-run.csv",
);
const outRincian = path.resolve(
  __dirname,
  "../../../scripts/legacy-master/legacy-hpp-aksesoris-cost-dry-run.csv",
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

/** Column header text → candidate MASTER SKU(s) to try. */
const ACCESSORY_COL_TO_SKUS: Record<string, string[]> = {
  "LABEL/S": ["LABEL SIZE S", "LABEL BLOK S"],
  "LABEL S": ["LABEL SIZE S", "LABEL BLOK S"],
  S: ["LABEL SIZE S"],
  M: ["LABEL SIZE M", "LABEL BLOK M"],
  L: ["LABEL SIZE L", "LABEL BLOK L"],
  XL: ["LABEL SIZE XL", "LABEL BLOK XL"],
  HANGTAG: ["HANGTAG", "HANTAG"],
  HANTAG: ["HANTAG", "HANGTAG"],
  "TALI HT": ["TALI HANTAG", "TALI HT CREAM", "TALI HT NK"],
  "TALI HANTAG": ["TALI HANTAG"],
  KARET: ["KARET", 'KARET 1.5"'],
  TAFETA: ["TAVETA", "TAFETA"],
  TAVETA: ["TAVETA"],
  OPP: ["PLASTIK OPP", "PLASTIK", "PLASTIK MIKA"],
  "KAIN KANTONG": [],
  BARCODE: ["BARCODE"],
  POLYMAILER: ["POLYMAILER", "POLYMAILER PUTIH"],
};

function normalizeHeader(h: string): string {
  return h.replace(/\s+/g, " ").trim().toUpperCase();
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const wb = XLSX.read(fs.readFileSync(excelPath), { type: "buffer" });
  const { prisma } = await import("@elorae/db");

  const items = await prisma.item.findMany({
    select: { id: true, sku: true, nameId: true, type: true },
  });
  const itemBySku = new Map(items.map((i) => [i.sku, i]));
  const skuSet = new Set(items.map((i) => i.sku));

  function resolveMaterialSku(candidates: string[]): string {
    for (const c of candidates) {
      if (skuSet.has(c)) return c;
    }
    // fuzzy: case-insensitive exact
    for (const c of candidates) {
      const hit = items.find((i) => i.sku.toLowerCase() === c.toLowerCase());
      if (hit) return hit.sku;
    }
    return candidates[0] ?? "";
  }

  // ---- JAHIT KE CMT ----
  const jahitName = resolveSheet(wb, "JAHIT KE CMT");
  const bomRows: Array<Record<string, unknown>> = [];

  if (jahitName) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[jahitName]!, {
      header: 1,
      defval: null,
      raw: true,
    });
    // Combine row1 + row2 headers where useful
    const r1 = (rows[0] ?? []).map((h) => trim(h));
    const r2 = (rows[1] ?? []).map((h) => trim(h));
    const headers: string[] = [];
    for (let c = 0; c < Math.max(r1.length, r2.length); c++) {
      const a = r1[c] || "";
      const b = r2[c] || "";
      // Prefer specific size letters under LABEL merge
      if (b && ["S", "M", "L", "XL"].includes(b.toUpperCase())) {
        headers[c] = b.toUpperCase();
      } else if (a) headers[c] = a;
      else headers[c] = b;
    }

    const artikelCol = headers.findIndex((h) => normalizeHeader(h) === "ARTIKEL");
    const estCol = headers.findIndex((h) => normalizeHeader(h) === "EST");
    const modelCol = headers.findIndex((h) => normalizeHeader(h) === "MODEL");

    const accessoryCols: Array<{ col: number; header: string; candidates: string[] }> = [];
    for (let c = 0; c < headers.length; c++) {
      const h = headers[c]!;
      const key = normalizeHeader(h);
      // Skip identity / fabric planning cols
      if (
        [
          "JENIS KAIN",
          "MODEL",
          "WARNA KAIN",
          "ARTIKEL",
          "HARGA JAHIT",
          "QTY YRD",
          "CONS",
          "EST",
          "CUTT",
          "CONS CMT",
          "ACC CONS",
          "SETORAN",
          "SELISIH",
          "LABEL",
        ].includes(key)
      ) {
        continue;
      }
      const candidates =
        ACCESSORY_COL_TO_SKUS[key] ??
        ACCESSORY_COL_TO_SKUS[h] ??
        (key.length <= 3 && ["S", "M", "L", "XL"].includes(key)
          ? ACCESSORY_COL_TO_SKUS[key]
          : undefined);
      if (!candidates || candidates.length === 0) {
        // Still record unknown accessory-like numeric columns under TALI KOLOR*
        if (/TALI|KANCING|ZIPPER|STOP|GESPER|CARE|POLY|OPP|KARET|TAF|HANG|LABEL/i.test(key)) {
          accessoryCols.push({ col: c, header: h || `COL${c}`, candidates: [h] });
        }
        continue;
      }
      accessoryCols.push({ col: c, header: h, candidates });
    }

    // Also map S/M/L/XL size columns explicitly if present
    for (const size of ["S", "M", "L", "XL"]) {
      const c = headers.findIndex((h) => normalizeHeader(h) === size);
      if (c >= 0 && !accessoryCols.some((a) => a.col === c)) {
        accessoryCols.push({
          col: c,
          header: size,
          candidates: ACCESSORY_COL_TO_SKUS[size]!,
        });
      }
    }

    console.log(`JAHIT headers (sample): ${headers.filter(Boolean).slice(0, 25).join(" | ")}`);
    console.log(`Accessory cols detected: ${accessoryCols.length}`);

    let lastArtikel = "";
    let lastModel = "";
    let lastEst: number | null = null;

    for (let i = 2; i < rows.length; i++) {
      const r = rows[i] ?? [];
      const artikelRaw = artikelCol >= 0 ? trim(r[artikelCol]) : "";
      const modelRaw = modelCol >= 0 ? trim(r[modelCol]) : "";
      const estRaw = estCol >= 0 ? num(r[estCol]) : null;

      if (artikelRaw) lastArtikel = artikelRaw.toUpperCase();
      if (modelRaw) lastModel = modelRaw;
      if (estRaw != null && estRaw > 0) lastEst = estRaw;

      if (!lastArtikel || !/^\d{8}[A-Z]/i.test(lastArtikel)) continue;

      const fg = itemBySku.get(lastArtikel);
      for (const ac of accessoryCols) {
        const qtyBatch = num(r[ac.col]);
        if (qtyBatch == null || qtyBatch === 0) continue;

        const materialSku = resolveMaterialSku(ac.candidates);
        const mat = materialSku ? itemBySku.get(materialSku) : undefined;
        const perUnit =
          lastEst && lastEst > 0 ? Math.round((qtyBatch / lastEst) * 10000) / 10000 : null;

        let decision = "WOULD_CREATE_RULE";
        if (!fg) decision = "FG_MISSING";
        else if (!mat) decision = "MATERIAL_UNMAPPED";
        else if (perUnit == null) decision = "NO_EST_DENOMINATOR";
        else if (perUnit <= 0) decision = "NON_POSITIVE_QTY";

        bomRows.push({
          sourceSheet: "JAHIT KE CMT",
          excelRow: i + 1,
          model: lastModel,
          finishedGoodSku: lastArtikel,
          fgInErp: fg ? "YES" : "NO",
          fgName: fg?.nameId ?? "",
          excelAccessoryCol: ac.header,
          materialSkuSuggested: materialSku,
          materialInErp: mat ? "YES" : "NO",
          materialName: mat?.nameId ?? "",
          batchQty: qtyBatch,
          est: lastEst ?? "",
          qtyRequiredProposed: perUnit ?? "",
          decision,
          clientConfirmed: "NO",
          notes:
            perUnit != null
              ? "qtyRequired = batchQty / EST (per garment estimate)"
              : "Could not divide by EST — review manually",
        });
      }
    }
  } else {
    console.warn("JAHIT KE CMT sheet missing");
  }

  // Dedupe by fg+material keeping first
  const seen = new Set<string>();
  const deduped: typeof bomRows = [];
  for (const r of bomRows) {
    const k = `${r.finishedGoodSku}||${r.materialSkuSuggested}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(r);
  }

  fs.writeFileSync(
    outBom,
    writeCsv(
      [
        "sourceSheet",
        "excelRow",
        "model",
        "finishedGoodSku",
        "fgInErp",
        "fgName",
        "excelAccessoryCol",
        "materialSkuSuggested",
        "materialInErp",
        "materialName",
        "batchQty",
        "est",
        "qtyRequiredProposed",
        "decision",
        "clientConfirmed",
        "notes",
      ],
      deduped,
    ),
    "utf8",
  );

  // ---- RINCIAN HPP AKSESORIS (cost reference, not qty) ----
  const rincianName = resolveSheet(wb, "RINCIAN HPP AKSESORIS");
  const costRows: Array<Record<string, unknown>> = [];
  if (rincianName) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[rincianName]!, {
      header: 1,
      defval: null,
      raw: true,
    });
    // Find header row with MODEL
    let headerIdx = 0;
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const cells = (rows[i] ?? []).map((c) => trim(c).toUpperCase());
      if (cells.includes("MODEL")) {
        headerIdx = i;
        break;
      }
    }
    const headers = (rows[headerIdx] ?? []).map((h) => trim(h));
    const modelCol = headers.findIndex((h) => h.toUpperCase() === "MODEL");
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i] ?? [];
      const model = modelCol >= 0 ? trim(r[modelCol]) : "";
      if (!model) continue;
      for (let c = 0; c < headers.length; c++) {
        if (c === modelCol) continue;
        const h = headers[c];
        if (!h) continue;
        const cost = num(r[c]);
        if (cost == null || cost === 0) continue;
        costRows.push({
          sourceSheet: "RINCIAN HPP AKSESORIS",
          excelRow: i + 1,
          model,
          accessoryComponent: h,
          unitCost: cost,
          notes: "COST ONLY — not a qty BOM line; use for HPP cross-check",
          clientConfirmed: "NO",
        });
      }
    }
  }

  fs.writeFileSync(
    outRincian,
    writeCsv(
      [
        "sourceSheet",
        "excelRow",
        "model",
        "accessoryComponent",
        "unitCost",
        "notes",
        "clientConfirmed",
      ],
      costRows,
    ),
    "utf8",
  );

  const bomCounts: Record<string, number> = {};
  for (const r of deduped) {
    const d = String(r.decision);
    bomCounts[d] = (bomCounts[d] ?? 0) + 1;
  }

  console.log("");
  console.log(`BOM candidate rules (deduped fg+material): ${deduped.length}`);
  for (const [k, v] of Object.entries(bomCounts).sort()) console.log(`  ${k}: ${v}`);
  console.log(`Wrote: ${outBom}`);
  console.log(`Rincian cost lines: ${costRows.length}`);
  console.log(`Wrote: ${outRincian}`);
  console.log("");
  console.log(">>> Dry-run only. Review qtyRequiredProposed before any apply.");
  console.log("    Fill clientConfirmed=YES on rows you trust; fix materialSkuSuggested if wrong.");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
