const path = require("node:path");
const { createRequire } = require("node:module");

const dbRoot = process.env.SMOKE_DB_PACKAGE_ROOT;
if (!dbRoot) {
  throw new Error("SMOKE_DB_PACKAGE_ROOT is required");
}

const requireFromDb = createRequire(path.join(dbRoot, "package.json"));
const bcrypt = requireFromDb("bcryptjs");
const { prisma } = require(path.join(dbRoot, "dist", "src", "index.js"));

const STORE_CODE = "SMOKE-KONSI-20260814";
const UOM_CODE = "SMOKE-PCS-20260814";

const products = [
  {
    sku: "SMOKE-KONSI-BASE",
    name: "Smoke Konsi Base Item",
    sellingPrice: 40000,
    variants: null,
    stocks: [{ variantSku: "", qtyOnHand: 10, reservedQty: 0, avgCost: 15000 }],
  },
  {
    sku: "SMOKE-KONSI-VARIANT",
    name: "Smoke Konsi Variant Item",
    sellingPrice: 60000,
    variants: [
      { sku: "SMOKE-KONSI-VARIANT-M", size: "M" },
      { sku: "SMOKE-KONSI-VARIANT-L", size: "L" },
    ],
    stocks: [
      { variantSku: "SMOKE-KONSI-VARIANT-M", qtyOnHand: 6, reservedQty: 0, avgCost: 20000 },
      { variantSku: "SMOKE-KONSI-VARIANT-L", qtyOnHand: 4, reservedQty: 0, avgCost: 20000 },
    ],
  },
  {
    sku: "SMOKE-KONSI-SUGGEST",
    name: "Smoke Never-Sent Suggestion",
    sellingPrice: 50000,
    variants: null,
    stocks: [{ variantSku: "", qtyOnHand: 12, reservedQty: 2, avgCost: 18000 }],
  },
];

async function upsertInventory(itemId, stock) {
  const existing = await prisma.inventoryValue.findFirst({
    where: { itemId, variantSku: stock.variantSku },
    select: { id: true },
  });
  const totalValue = stock.qtyOnHand * stock.avgCost;
  if (existing) {
    return prisma.inventoryValue.update({
      where: { id: existing.id },
      data: {
        qtyOnHand: stock.qtyOnHand,
        reservedQty: stock.reservedQty,
        avgCost: stock.avgCost,
        totalValue,
      },
    });
  }
  return prisma.inventoryValue.create({
    data: {
      itemId,
      variantSku: stock.variantSku,
      qtyOnHand: stock.qtyOnHand,
      reservedQty: stock.reservedQty,
      avgCost: stock.avgCost,
      totalValue,
    },
  });
}

async function main() {
  const outboxBefore = await prisma.jubelioOutbox.count();
  const permission = await prisma.permission.upsert({
    where: { code: "pwa:access" },
    update: {},
    create: {
      code: "pwa:access",
      module: "pwa",
      action: "access",
      description: "Access to the PWA route tree",
    },
  });
  const role = await prisma.roleDefinition.upsert({
    where: { name: "SALESMAN" },
    update: { isSystem: false },
    create: {
      name: "SALESMAN",
      description: "Field salesman — PWA-only access",
      isSystem: false,
    },
  });
  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: role.id,
        permissionId: permission.id,
      },
    },
    update: {},
    create: {
      roleId: role.id,
      permissionId: permission.id,
    },
  });
  const salesman = await prisma.user.upsert({
    where: { email: "salesman@elorae.com" },
    update: {
      name: "Smoke Salesman",
      passwordHash: await bcrypt.hash("salesman123", 10),
      pinHash: await bcrypt.hash("123456", 10),
      roleId: role.id,
    },
    create: {
      email: "salesman@elorae.com",
      name: "Smoke Salesman",
      passwordHash: await bcrypt.hash("salesman123", 10),
      pinHash: await bcrypt.hash("123456", 10),
      roleId: role.id,
    },
  });

  const store = await prisma.store.upsert({
    where: { code: STORE_CODE },
    update: {
      name: "Smoke Test Konsi Store",
      address: "Local Smoke Test Address",
      termsType: "KONSI",
      paymentTempo: 30,
      marginPercent: 20,
      lat: -6.2,
      lng: 106.8,
      isActive: true,
    },
    create: {
      code: STORE_CODE,
      name: "Smoke Test Konsi Store",
      address: "Local Smoke Test Address",
      termsType: "KONSI",
      paymentTempo: 30,
      marginPercent: 20,
      lat: -6.2,
      lng: 106.8,
      isActive: true,
    },
  });

  const uom = await prisma.uOM.upsert({
    where: { code: UOM_CODE },
    update: { nameId: "pcs", nameEn: "pcs" },
    create: { code: UOM_CODE, nameId: "pcs", nameEn: "pcs" },
  });

  const fixtureItems = [];
  for (const product of products) {
    const item = await prisma.item.upsert({
      where: { sku: product.sku },
      update: {
        nameId: product.name,
        nameEn: product.name,
        type: "FINISHED_GOOD",
        uomId: uom.id,
        isActive: true,
        sellingPrice: product.sellingPrice,
        variants: product.variants,
        source: "ERP",
      },
      create: {
        sku: product.sku,
        nameId: product.name,
        nameEn: product.name,
        type: "FINISHED_GOOD",
        uomId: uom.id,
        isActive: true,
        sellingPrice: product.sellingPrice,
        variants: product.variants,
        source: "ERP",
      },
    });
    for (const stock of product.stocks) {
      await upsertInventory(item.id, stock);
    }
    fixtureItems.push({ id: item.id, sku: item.sku });
  }

  const outboxAfter = await prisma.jubelioOutbox.count();

  console.log(JSON.stringify({
    store: { id: store.id, code: store.code },
    salesman: { id: salesman.id, email: salesman.email },
    items: fixtureItems,
    outbox: { before: outboxBefore, after: outboxAfter, delta: outboxAfter - outboxBefore },
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
