// Fixture for test-run/konsi-lifecycle-edge-plan.md. Local test bed (3308) only.
// Run: node test-run/setup-konsi-lifecycle-edge.cjs  (from repo root; DATABASE_URL from apps/web/.env)
const path = require("node:path");
const { createRequire } = require("node:module");

const dbRoot = path.join(__dirname, "..", "packages", "db");
const requireFromDb = createRequire(path.join(dbRoot, "package.json"));
requireFromDb("dotenv").config({ path: path.join(__dirname, "..", "apps", "web", ".env") });

const url = process.env.DATABASE_URL || "";
if (!/127\.0\.0\.1:3308|localhost:3308/.test(url)) {
  throw new Error(`Refusing to run: DATABASE_URL is not the 3308 test bed`);
}

const bcrypt = requireFromDb("bcryptjs");
const { prisma } = require(path.join(dbRoot, "dist", "src", "index.js"));

const TAG = "KLC";
const UOM_CODE = `SMOKE-PCS-${TAG}`;

const stores = [
  { code: `SMOKE-${TAG}-A`, name: "Smoke KLC Store A (SPG POS)", termsType: "KONSI", paymentTempo: 30, markupPercent: 20, sellThroughMethod: "SPG_POS" },
  { code: `SMOKE-${TAG}-B`, name: "Smoke KLC Store B (Shelf count)", termsType: "KONSI", paymentTempo: 14, markupPercent: null, sellThroughMethod: "SHELF_COUNT" },
  { code: `SMOKE-${TAG}-C`, name: "Smoke KLC Store C (no method)", termsType: "KONSI", paymentTempo: 30, markupPercent: 25, sellThroughMethod: null },
  { code: `SMOKE-${TAG}-P`, name: "Smoke KLC Store P (Putus)", termsType: "PUTUS", paymentTempo: 30, markupPercent: null, sellThroughMethod: null },
];

const products = [
  { sku: `${TAG}-SIMPLE`, name: "KLC Simple", sellingPrice: 100000, variants: null, stocks: [{ variantSku: "", qtyOnHand: 50, avgCost: 40000 }] },
  {
    sku: `${TAG}-VAR`, name: "KLC Variant", sellingPrice: 150000,
    variants: [{ sku: `${TAG}-VAR-M`, size: "M" }, { sku: `${TAG}-VAR-L`, size: "L" }],
    stocks: [{ variantSku: `${TAG}-VAR-M`, qtyOnHand: 20, avgCost: 60000 }, { variantSku: `${TAG}-VAR-L`, qtyOnHand: 20, avgCost: 60000 }],
  },
  { sku: `${TAG}-NOPRICE`, name: "KLC No Price", sellingPrice: null, variants: null, stocks: [{ variantSku: "", qtyOnHand: 10, avgCost: 30000 }] },
  { sku: `${TAG}-SHORT`, name: "KLC Short", sellingPrice: 80000, variants: null, stocks: [{ variantSku: "", qtyOnHand: 2, avgCost: 30000 }] },
  { sku: `${TAG}-NEVER`, name: "KLC Never Sent", sellingPrice: 90000, variants: null, stocks: [{ variantSku: "", qtyOnHand: 15, avgCost: 35000 }] },
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
  const outboxBefore = await prisma.jubelioOutbox.count();

  const uom = await prisma.uOM.upsert({
    where: { code: UOM_CODE },
    update: {},
    create: { code: UOM_CODE, nameId: "pcs", nameEn: "pcs" },
  });

  const storeRows = {};
  for (const s of stores) {
    const data = {
      name: s.name, address: "Local KLC fixture", termsType: s.termsType, paymentTempo: s.paymentTempo,
      markupPercent: s.markupPercent, sellThroughMethod: s.sellThroughMethod, lat: -6.2, lng: 106.8, isActive: true,
    };
    const row = await prisma.store.upsert({ where: { code: s.code }, update: data, create: { code: s.code, ...data } });
    storeRows[s.code.slice(-1)] = { id: row.id, code: row.code };
  }

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

  const spg = await prisma.user.update({
    where: { email: "spg@elorae.com" },
    data: { assignedStoreId: storeRows.A.id, passwordHash: await bcrypt.hash("spg123", 10) },
    select: { id: true, email: true },
  });
  const salesman = await prisma.user.update({
    where: { email: "salesman@elorae.com" },
    data: { passwordHash: await bcrypt.hash("salesman123", 10) },
    select: { id: true, email: true },
  });

  const outboxAfter = await prisma.jubelioOutbox.count();
  console.log(JSON.stringify({ stores: storeRows, items: itemRows, spg, salesman, outbox: { before: outboxBefore, after: outboxAfter } }, null, 2));
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
