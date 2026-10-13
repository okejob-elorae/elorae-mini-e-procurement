/**
 * Relabel legacy fabrics bought in yards from MTR to YD (#438).
 *
 * `pnpm legacy:master` once mapped the workbook's YRD onto MTR because it looked for a `YRD` UOM
 * and the yard UOM is seeded as `YD`. Quantities and costs were always per yard (MASTER HPP and
 * BELI prices are per YRD), so only the label is wrong: this sets `uomId` to YD and converts no
 * figure. Items the workbook really counts in MTR (KARET, TALI SERUT) are left alone.
 *
 * Usage (from apps/web):
 *   pnpm legacy:fabric:uom                                  # dry-run
 *   pnpm legacy:fabric:uom -- --apply                       # local testbed (:3308)
 *   pnpm legacy:fabric:uom -- --apply --confirm-prod-writes # prod tunnel
 *   --excel <path>   default: other-sources/PRODUKSI ELORAE LAURA.xlsx
 */
import "dotenv/config";
import * as path from "path";
import { parseMasterWorkbook } from "../../../scripts/legacy-master/parse-master";

function assertApplyAllowed(url: string, confirm: boolean): void {
  if (/:3308(\/|$)/.test(url)) return;
  if (!confirm) throw new Error("Refusing --apply: not local testbed (:3308). Pass --confirm-prod-writes.");
  console.warn("WARNING: relabelling fabric UOM against a non-testbed DATABASE_URL.");
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const excelAt = argv.indexOf("--excel");
  const excelPath =
    excelAt >= 0 && argv[excelAt + 1]
      ? path.resolve(argv[excelAt + 1]!)
      : path.resolve(__dirname, "../../../other-sources/PRODUKSI ELORAE LAURA.xlsx");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  if (apply) assertApplyAllowed(url, argv.includes("--confirm-prod-writes"));

  const yrdSkus = parseMasterWorkbook(excelPath)
    .rows.filter((r) => r.satuan.trim().toUpperCase() === "YRD")
    .map((r) => r.sku.trim());

  const { prisma } = await import("@elorae/db");
  try {
    const [yd, mtr] = await Promise.all([
      prisma.uOM.findUnique({ where: { code: "YD" } }),
      prisma.uOM.findUnique({ where: { code: "MTR" } }),
    ]);
    if (!yd || !mtr) throw new Error("UOM YD or MTR not seeded");

    const targets = await prisma.item.findMany({
      where: { type: "FABRIC", uomId: mtr.id, sku: { in: yrdSkus } },
      select: { id: true, sku: true },
      orderBy: { sku: "asc" },
    });
    const ids = targets.map((t) => t.id);
    // Rows that carry their own UOM would keep saying MTR after the relabel.
    const [poLines, rolls] = await Promise.all([
      prisma.pOItem.count({ where: { itemId: { in: ids }, uomId: mtr.id } }),
      prisma.fabricRoll.count({ where: { itemId: { in: ids }, uomId: mtr.id } }),
    ]);

    console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
    console.log(`MASTER YRD rows: ${yrdSkus.length} | FABRIC items stored as MTR: ${targets.length}`);
    console.log(`  ${targets.slice(0, 8).map((t) => t.sku).join(", ")}${targets.length > 8 ? ", …" : ""}`);
    console.log(`MTR-labelled PO lines: ${poLines} | fabric rolls: ${rolls}`);
    if (poLines + rolls > 0) throw new Error("Refusing: PO lines or rolls still say MTR for these items.");
    if (!apply || ids.length === 0) return;

    const { count } = await prisma.item.updateMany({ where: { id: { in: ids } }, data: { uomId: yd.id } });
    console.log(`Relabelled ${count} fabrics to YD.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
