/**
 * Random sample: Excel parent SKUs vs ERP/Jubelio size-variant SKUs.
 * Run: pnpm sample:umkm-sku (from apps/web)
 */
import "dotenv/config";
import { prisma } from "@elorae/db";
import { parseUmkmExcelFile } from "../lib/reconciliation/umkm-excel-parse";
import {
  buildErpVariantIndex,
  EXCEL_SIZE_KEYS,
  excelSizeToErpVariantSku,
  extractParentFromVariantSku,
  listErpVariantsForParent,
} from "../lib/reconciliation/umkm-sku-bridge";

function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

async function main() {
  const excelPath = process.argv[2] ?? "../../Temp Elorae Reconciliation.xlsx";
  const excelRows = parseUmkmExcelFile(excelPath);
  const parents = [...new Set(excelRows.map((r) => r.parentKode))].sort();

  const mappings = await prisma.jubelioProductMapping.findMany({
    select: {
      itemId: true,
      erpVariantSku: true,
      jubelioItemCode: true,
      jubelioItemId: true,
      item: { select: { sku: true, nameId: true } },
    },
  });

  const index = buildErpVariantIndex(
    mappings.map((m) => {
      const { sizeSuffix } = extractParentFromVariantSku(m.erpVariantSku);
      return {
        erpVariantSku: m.erpVariantSku,
        jubelioItemCode: m.jubelioItemCode,
        jubelioItemId: m.jubelioItemId,
        itemId: m.itemId,
        parentItemSku: m.item.sku,
        itemName: m.item.nameId,
        sizeSuffix,
      };
    }),
  );

  let matchedParents = 0;
  const unmatched: string[] = [];
  for (const p of parents) {
    const hits = listErpVariantsForParent(index, p);
    if (hits.length > 0) matchedParents++;
    else unmatched.push(p);
  }

  console.log("=== SKU bridge sample ===");
  console.log(`Excel UMKM parent codes: ${parents.length}`);
  console.log(`ERP Jubelio variant rows: ${mappings.length}`);
  console.log(`Parents with ≥1 ERP size variant: ${matchedParents}`);
  console.log(`Parents with no ERP match: ${unmatched.length}`);
  if (unmatched.length > 0) {
    console.log(`  e.g. ${unmatched.slice(0, 10).join(", ")}`);
  }

  console.log("\n--- Random Excel parents (5) ---");
  for (const parent of pickRandom(parents, 5)) {
    const line = excelRows.find((r) => r.parentKode === parent);
    const erpHits = listErpVariantsForParent(index, parent);
    console.log(`\nExcel parent: ${parent} (${line?.namaBarang ?? "?"})`);
    console.log(
      `  Excel sizes: S=${line?.sizes.S ?? 0} M=${line?.sizes.M ?? 0} L=${line?.sizes.L ?? 0} XL=${line?.sizes.XL ?? 0}`,
    );
    console.log(
      `  Expected ERP SKUs: ${EXCEL_SIZE_KEYS.map((s) => excelSizeToErpVariantSku(parent, s)).join(", ")}`,
    );
    if (erpHits.length === 0) {
      console.log("  ERP match: NONE");
    } else {
      for (const v of erpHits) {
        console.log(
          `  ERP: ${v.erpVariantSku} (item ${v.parentItemSku}, jubelio ${v.jubelioItemId})`,
        );
      }
    }
  }

  console.log("\n--- Random ERP variants (5) ---");
  for (const m of pickRandom(mappings, 5)) {
    const { parent, sizeSuffix } = extractParentFromVariantSku(m.erpVariantSku);
    console.log(
      `${m.erpVariantSku} → parent "${parent}" size "${sizeSuffix ?? "?"}" | item ${m.item.sku} | ${m.item.nameId}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
