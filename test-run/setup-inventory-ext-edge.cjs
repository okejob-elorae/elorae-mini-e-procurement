// Fixture for test-run/inventory-extensions-edge-plan.md. Local test bed (3308) only.
// Run: node test-run/setup-inventory-ext-edge.cjs  (from repo root; DATABASE_URL from apps/web/.env)
// Seeds main-warehouse stock for the IXT items; the driver creates fresh stores/canvasser per run.
const path = require("node:path");
const { createRequire } = require("node:module");

const dbRoot = path.join(__dirname, "..", "packages", "db");
const requireFromDb = createRequire(path.join(dbRoot, "package.json"));
requireFromDb("dotenv").config({ path: path.join(__dirname, "..", "apps", "web", ".env") });

const url = process.env.DATABASE_URL || "";
if (!/127\.0\.0\.1:3308|localhost:3308/.test(url)) {
  throw new Error(`Refusing to run: DATABASE_URL is not the 3308 test bed`);
}

const { prisma } = require(path.join(dbRoot, "dist", "src", "index.js"));

const TAG = "IXT";
const UOM_CODE = `SMOKE-PCS-${TAG}`;

const products = [
  { sku: `${TAG}-SIMPLE`, name: "IXT Simple", sellingPrice: 100000, variants: null, stocks: [{ variantSku: "", qtyOnHand: 200, avgCost: 40000 }] },
  {
    sku: `${TAG}-VAR`, name: "IXT Variant", sellingPrice: 150000,
    variants: [{ sku: `${TAG}-VAR-M`, size: "M" }, { sku: `${TAG}-VAR-L`, size: "L" }],
    stocks: [{ variantSku: `${TAG}-VAR-M`, qtyOnHand: 100, avgCost: 60000 }, { variantSku: `${TAG}-VAR-L`, qtyOnHand: 100, avgCost: 60000 }],
  },
  { sku: `${TAG}-NOPRICE`, name: "IXT No Price", sellingPrice: null, variants: null, stocks: [{ variantSku: "", qtyOnHand: 50, avgCost: 30000 }] },
];

async function upsertInventory(itemId, stock) {
  const existing = await prisma.inventoryValue.findFirst({
    where: { itemId, OR: [{ variantSku: stock.variantSku }, ...(stock.variantSku === "" ? [{ variantSku: null }] : [])] },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  const data = { qtyOnHand: stock.qtyOnHand, reservedQty: 0, avgCost: stock.avgCost, totalValue: stock.qtyOnHand * stock.avgCost };
  if (existing) return prisma.inventoryValue.update({ where: { id: existing.id }, data });
  return prisma.inventoryValue.create({ data: { itemId, variantSku: stock.variantSku, ...data } });
}

async function main() {
  const uom = await prisma.uOM.upsert({
    where: { code: UOM_CODE },
    update: {},
    create: { code: UOM_CODE, nameId: "pcs", nameEn: "pcs" },
  });

  const itemRows = {};
  for (const p of products) {
    const data = {
      nameId: p.name, nameEn: p.name, type: "FINISHED_GOOD", uomId: uom.id, isActive: true,
      sellingPrice: p.sellingPrice, variants: p.variants ?? undefined, source: "ERP",
    };
    const item = await prisma.item.upsert({ where: { sku: p.sku }, update: data, create: { sku: p.sku, ...data } });
    for (const st of p.stocks) await upsertInventory(item.id, st);
    itemRows[p.sku] = item.id;
  }
  console.log(JSON.stringify({ items: itemRows }, null, 2));
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
