/**
 * BELI sheet ↔ Item.sku reconcile (read-only, no stock writes).
 *
 * Usage (from apps/web):
 *   pnpm legacy:beli:reconcile
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";
import { writeCsv } from "../../../scripts/legacy-master/csv-util";

const excelPath = path.resolve(__dirname, "../../../PRODUKSI ELORAE LAURA.xlsx");
const outPath = path.resolve(
  __dirname,
  "../../../scripts/legacy-master/legacy-beli-reconcile.csv",
);

function trim(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

function resolveSheet(wb: XLSX.WorkBook, wanted: string): string | null {
  return (
    wb.SheetNames.find((n) => n === wanted) ??
    wb.SheetNames.find((n) => n.trim() === wanted.trim()) ??
    null
  );
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const wb = XLSX.read(fs.readFileSync(excelPath), { type: "buffer" });
  const sheetName = resolveSheet(wb, "BELI ") ?? resolveSheet(wb, "BELI");
  if (!sheetName) throw new Error("BELI sheet not found");

  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName]!, {
    header: 1,
    defval: null,
    raw: true,
  });
  const header = (rows[0] ?? []).map((h) => trim(h).toUpperCase());
  const col = (name: string) => header.indexOf(name.toUpperCase());
  const skuCol = col("KODE BARANG");
  const nameCol = col("NAMA BARANG");
  const qtyCol = col("QTY BELI");
  const hargaCol = col("HARGA BELI");
  const supplierCol = col("SUPLLIER") >= 0 ? col("SUPLLIER") : col("SUPPLIER");
  const tglCol = col("TGL");

  if (skuCol < 0) throw new Error("KODE BARANG column missing on BELI");

  type Agg = {
    sku: string;
    namaBarang: string;
    lineCount: number;
    totalQty: number;
    suppliers: Set<string>;
  };
  const bySku = new Map<string, Agg>();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const sku = trim(r[skuCol]);
    if (!sku) continue;
    const e =
      bySku.get(sku) ??
      ({
        sku,
        namaBarang: trim(r[nameCol]),
        lineCount: 0,
        totalQty: 0,
        suppliers: new Set<string>(),
      } satisfies Agg);
    e.lineCount += 1;
    const qty = Number(trim(r[qtyCol]).replace(/,/g, ""));
    if (Number.isFinite(qty)) e.totalQty += qty;
    const sup = trim(r[supplierCol]);
    if (sup) e.suppliers.add(sup);
    if (!e.namaBarang) e.namaBarang = trim(r[nameCol]);
    bySku.set(sku, e);
  }

  const { prisma } = await import("@elorae/db");
  const items = await prisma.item.findMany({
    where: { sku: { in: [...bySku.keys()] } },
    select: { sku: true, nameId: true, type: true, isActive: true, id: true },
  });
  const itemBySku = new Map(items.map((it) => [it.sku, it]));

  const out = [...bySku.values()]
    .sort((a, b) => a.sku.localeCompare(b.sku))
    .map((a) => {
      const hit = itemBySku.get(a.sku);
      return {
        sku: a.sku,
        excelNamaBarang: a.namaBarang,
        lineCount: a.lineCount,
        totalQty: a.totalQty,
        suppliers: [...a.suppliers].join("; "),
        matchStatus: hit ? "IN_ERP" : "MISSING_IN_ERP",
        erpNameId: hit?.nameId ?? "",
        erpType: hit?.type ?? "",
        erpIsActive: hit ? String(hit.isActive) : "",
        nameMismatch: hit
          ? a.namaBarang.trim().toLowerCase() !== hit.nameId.trim().toLowerCase()
            ? "YES"
            : "NO"
          : "",
      };
    });

  fs.writeFileSync(
    outPath,
    writeCsv(
      [
        "sku",
        "excelNamaBarang",
        "lineCount",
        "totalQty",
        "suppliers",
        "matchStatus",
        "erpNameId",
        "erpType",
        "erpIsActive",
        "nameMismatch",
      ],
      out,
    ),
    "utf8",
  );

  const missing = out.filter((r) => r.matchStatus === "MISSING_IN_ERP").length;
  const matched = out.filter((r) => r.matchStatus === "IN_ERP").length;
  const nameMismatch = out.filter((r) => r.nameMismatch === "YES").length;

  console.log(`BELI sheet: ${sheetName}`);
  console.log(`Distinct KODE BARANG: ${out.length}`);
  console.log(`  IN_ERP:          ${matched}`);
  console.log(`  MISSING_IN_ERP:  ${missing}`);
  console.log(`  nameMismatch:    ${nameMismatch}`);
  console.log(`Wrote: ${outPath}`);
  if (missing) {
    console.log("");
    console.log("Missing SKUs (first 20):");
    for (const r of out.filter((x) => x.matchStatus === "MISSING_IN_ERP").slice(0, 20)) {
      console.log(`  ${r.sku}  (${r.excelNamaBarang})`);
    }
  }

  // silence unused
  void tglCol;
  void hargaCol;

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
