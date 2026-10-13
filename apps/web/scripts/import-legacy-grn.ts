/**
 * Legacy BELI sheet → GRN import (#438). One GRN per nota, replayed in date order so material
 * stock and moving-average cost become the sum of the workbook's purchase history.
 *
 * Writes what `createGRN` writes (GRN row, `calculateMovingAverage` per line, processed items JSON)
 * but dated at the nota's day, with no PO link, no fabric rolls, no journal and no notifications —
 * the GL is not cut over, and these receipts happened before the ERP existed.
 *
 * Idempotent: a nota's GRN is `LEG-GRN-<nota>`; a nota whose GRN exists is skipped. Notas whose
 * supplier is SKIP or unmapped in the alias map are held back and listed, never guessed.
 *
 * Usage (from apps/web):
 *   pnpm legacy:grn                                                   # dry-run
 *   pnpm legacy:grn -- --apply --actor admin@elorae.com               # local testbed (:3308)
 *   pnpm legacy:grn -- --apply --actor <email> --confirm-prod-writes  # prod tunnel
 *   --excel <path>   default: other-sources/PRODUKSI ELORAE LAURA.xlsx
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";
import { Decimal } from "decimal.js";
import { calculateMovingAverage } from "../lib/inventory/costing";
import { groupBeliNotas, parseBeliMatrix, type BeliNota } from "../lib/legacy-import/parse-beli";

/** Local, gitignored review output of `pnpm legacy:suppliers` (client data). Unquoted CSV. */
const ALIAS_MAP = path.resolve(__dirname, "../../../scripts/legacy-master/legacy-supplier-alias-map.csv");

function readAliasMap(file: string): Map<string, { supplierCode: string; action: string }> {
  const [header, ...rows] = fs.readFileSync(file, "utf8").trim().split(/\r?\n/).map((l) => l.split(","));
  const at = (name: string) => header!.indexOf(name);
  return new Map(
    rows.map((r) => [r[at("excelName")]!.trim().toUpperCase(), { supplierCode: r[at("supplierCode")]!.trim(), action: r[at("action")]!.trim() }]),
  );
}
const DOC_PREFIX = "LEG-GRN-";
/** Workbook SAT spellings that mean the item's own UOM code. */
const SAT_TO_UOM: Record<string, string> = { YRD: "YD" };

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function assertApplyAllowed(url: string, confirm: boolean): void {
  if (/:3308(\/|$)/.test(url)) return;
  if (!confirm) throw new Error("Refusing --apply: not local testbed (:3308). Pass --confirm-prod-writes.");
  console.warn("WARNING: importing legacy GRNs against a non-testbed DATABASE_URL.");
}

const docNumberFor = (nota: string) => `${DOC_PREFIX}${nota.padStart(4, "0")}`;

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const excelPath = path.resolve(arg(argv, "--excel") ?? path.resolve(__dirname, "../../../other-sources/PRODUKSI ELORAE LAURA.xlsx"));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  if (apply) assertApplyAllowed(url, argv.includes("--confirm-prod-writes"));

  const wb = XLSX.read(fs.readFileSync(excelPath), { type: "buffer" });
  const sheet = wb.SheetNames.find((n) => n.trim() === "BELI");
  if (!sheet) throw new Error("BELI sheet not found");
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet]!, { header: 1, defval: null, raw: true });
  const { lines, skipped } = parseBeliMatrix(matrix);
  const { notas, conflicts } = groupBeliNotas(lines);

  const aliases = readAliasMap(ALIAS_MAP);

  const { prisma } = await import("@elorae/db");
  try {
    const actorEmail = arg(argv, "--actor");
    const actor = actorEmail ? await prisma.user.findUnique({ where: { email: actorEmail }, select: { id: true } }) : null;
    if (apply && !actor) throw new Error("--apply needs --actor <email> of an existing user");

    const [suppliers, items, existing] = await Promise.all([
      prisma.supplier.findMany({ select: { id: true, code: true } }),
      prisma.item.findMany({
        where: { type: { in: ["FABRIC", "ACCESSORIES"] } },
        select: { id: true, sku: true, type: true, uomId: true, overReceiveThreshold: true, uom: { select: { code: true } } },
      }),
      prisma.gRN.findMany({ where: { docNumber: { startsWith: DOC_PREFIX } }, select: { docNumber: true } }),
    ]);
    const supplierByCode = new Map(suppliers.map((s) => [s.code, s.id]));
    const itemBySku = new Map(items.map((i) => [i.sku.trim().toUpperCase(), i]));
    const done = new Set(existing.map((g) => g.docNumber));

    const held: Array<{ nota: string; supplier: string; reason: string }> = [];
    const unknownItems = new Map<string, number>();
    const uomMismatch = new Map<string, string>();
    const ready: Array<{ nota: BeliNota; supplierId: string }> = [];
    for (const nota of notas) {
      const alias = aliases.get(nota.supplier.toUpperCase());
      const supplierId = alias?.supplierCode ? supplierByCode.get(alias.supplierCode) : undefined;
      if (!supplierId) {
        held.push({ nota: nota.nota, supplier: nota.supplier, reason: alias?.action === "SKIP" ? "SUPPLIER_SKIP" : "SUPPLIER_UNMAPPED" });
        continue;
      }
      let ok = true;
      for (const l of nota.lines) {
        const item = itemBySku.get(l.kode.toUpperCase());
        if (!item) {
          unknownItems.set(l.kode, (unknownItems.get(l.kode) ?? 0) + 1);
          ok = false;
          continue;
        }
        const sat = SAT_TO_UOM[l.sat.toUpperCase()] ?? l.sat.toUpperCase();
        if (sat && sat !== item.uom.code) uomMismatch.set(l.kode, `${l.sat} vs ${item.uom.code}`);
      }
      if (!ok) held.push({ nota: nota.nota, supplier: nota.supplier, reason: "UNKNOWN_ITEM" });
      else ready.push({ nota, supplierId });
    }
    const todo = ready.filter((r) => !done.has(docNumberFor(r.nota.nota)));
    const value = todo.reduce((s, r) => s + r.nota.lines.reduce((t, l) => t + l.qty * l.price, 0), 0);

    console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
    console.log(`BELI lines: ${lines.length} (skipped ${skipped.length}: ${JSON.stringify(skipped)})`);
    console.log(`Notas: ${notas.length} | conflicting: ${conflicts.length} ${JSON.stringify(conflicts)}`);
    console.log(`Ready: ${ready.length} | already imported: ${ready.length - todo.length} | to write: ${todo.length} (value ${Math.round(value).toLocaleString("id-ID")})`);
    console.log(`Held: ${held.length} ${JSON.stringify(held)}`);
    console.log(`Unknown item codes: ${JSON.stringify([...unknownItems])}`);
    console.log(`SAT vs item UOM mismatches (imported as the item's UOM): ${JSON.stringify([...uomMismatch])}`);
    if (!apply) return;

    let written = 0;
    for (const { nota, supplierId } of todo) {
      const docNumber = docNumberFor(nota.nota);
      await prisma.$transaction(async (tx) => {
        const base = nota.lines.map((l) => {
          const item = itemBySku.get(l.kode.toUpperCase())!;
          return {
            itemId: item.id,
            variantSku: null,
            qty: l.qty,
            unitCost: l.price,
            itemType: item.type,
            uomId: item.uomId,
            overReceiveThreshold: item.overReceiveThreshold != null ? Number(item.overReceiveThreshold) : null,
            rolls: [],
            totalCost: new Decimal(l.qty).mul(l.price).toNumber(),
          };
        });
        const grn = await tx.gRN.create({
          data: {
            docNumber,
            supplierId,
            grnDate: nota.date,
            createdAt: nota.date,
            receivedBy: actor!.id,
            totalAmount: base.reduce((s, l) => s.plus(l.totalCost), new Decimal(0)).toNumber(),
            items: JSON.stringify(base),
            notes: `Legacy import #438: workbook BELI nota ${nota.nota} (${nota.supplier})`,
          },
        });
        const processed = [];
        for (const line of base) {
          const calc = await calculateMovingAverage(line.itemId, new Decimal(line.qty), new Decimal(line.unitCost), tx, null, {
            refType: "GRN",
            refId: grn.id,
            refDocNumber: docNumber,
            createdById: actor!.id,
            occurredAt: nota.date,
          });
          processed.push({
            ...line,
            prevAvgCost: calc.previousAvgCost.toNumber(),
            newAvgCost: calc.newAvgCost.toNumber(),
            prevQty: calc.previousQty.toNumber(),
            newQty: calc.newQty.toNumber(),
          });
        }
        await tx.gRN.update({ where: { id: grn.id }, data: { items: JSON.stringify(processed) } });
      });
      written += 1;
    }
    console.log(`Wrote ${written} GRNs.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
