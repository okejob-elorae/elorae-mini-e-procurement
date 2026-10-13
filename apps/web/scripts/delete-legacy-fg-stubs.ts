/**
 * Delete the inactive FG stubs `pnpm legacy:master -- --apply-fg-stubs` created (#438).
 *
 * The stubs (`24000011T`, `27000145P S`, …) duplicate Jubelio variants: the artikel-level FG is the
 * Jubelio parent, whose variants carry colour × size (#437). A stub is deleted together with its
 * BOM rules and its empty InventoryValue rows. Refuses when any stub has stock, or rows that the
 * delete would cascade or null out (ItemImage, PlanCategory, SalesHistory, ForecastResult); any
 * other reference aborts the transaction through its foreign key.
 *
 * Usage (from apps/web):
 *   pnpm legacy:stubs:delete                                  # dry-run
 *   pnpm legacy:stubs:delete -- --apply                       # local testbed (:3308)
 *   pnpm legacy:stubs:delete -- --apply --confirm-prod-writes # prod tunnel
 */
import "dotenv/config";

const STUB_MARKER = "LEGACY_MASTER_STUB";

function assertApplyAllowed(url: string, confirm: boolean): void {
  if (/:3308(\/|$)/.test(url)) return;
  if (!confirm) throw new Error("Refusing --apply: not local testbed (:3308). Pass --confirm-prod-writes.");
  console.warn("WARNING: deleting FG stubs against a non-testbed DATABASE_URL.");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  if (apply) assertApplyAllowed(url, process.argv.includes("--confirm-prod-writes"));

  const { prisma } = await import("@elorae/db");
  try {
    const stubs = await prisma.item.findMany({
      where: { type: "FINISHED_GOOD", source: "ERP", isActive: false, description: { startsWith: STUB_MARKER } },
      select: { id: true, sku: true },
      orderBy: { sku: "asc" },
    });
    const ids = stubs.map((s) => s.id);
    const scope = { itemId: { in: ids } };
    const [rules, values, stocked, images, plans, history, forecasts] = await Promise.all([
      prisma.consumptionRule.count({ where: { finishedGoodId: { in: ids } } }),
      prisma.inventoryValue.count({ where: scope }),
      prisma.inventoryValue.count({ where: { ...scope, OR: [{ qtyOnHand: { not: 0 } }, { reservedQty: { not: 0 } }] } }),
      prisma.itemImage.count({ where: scope }),
      prisma.planCategory.count({ where: scope }),
      prisma.salesHistory.count({ where: scope }),
      prisma.forecastResult.count({ where: scope }),
    ]);

    console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
    console.log(`Stubs: ${stubs.length} (${stubs.slice(0, 5).map((s) => s.sku).join(", ")}${stubs.length > 5 ? ", …" : ""})`);
    console.log(`BOM rules: ${rules} | InventoryValue rows: ${values} (with stock: ${stocked})`);
    console.log(`Blocking refs — images: ${images}, plan categories: ${plans}, sales history: ${history}, forecasts: ${forecasts}`);
    if (stocked + images + plans + history + forecasts > 0) throw new Error("Refusing: a stub is still in use.");
    if (!apply || ids.length === 0) return;

    const deleted = await prisma.$transaction(async (tx) => {
      await tx.consumptionRule.deleteMany({ where: { finishedGoodId: { in: ids } } });
      await tx.inventoryValue.deleteMany({ where: scope });
      return (await tx.item.deleteMany({ where: { id: { in: ids } } })).count;
    });
    console.log(`Deleted ${deleted} stubs.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
