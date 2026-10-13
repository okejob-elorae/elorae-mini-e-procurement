const path = require("node:path");
const { createRequire } = require("node:module");

const dbRoot = process.env.SMOKE_DB_PACKAGE_ROOT;
if (!dbRoot) {
  throw new Error("SMOKE_DB_PACKAGE_ROOT is required");
}

const requireFromDb = createRequire(path.join(dbRoot, "package.json"));
const bcrypt = requireFromDb("bcryptjs");
const { prisma } = require(path.join(dbRoot, "dist", "src", "index.js"));

const STORE_CODE = "SMOKE-PUTUS-20260814";
const UOM_CODE = "SMOKE-PCS-PUTUS-20260814";

const products = [
  {
    sku: "SMOKE-PUTUS-BASE",
    name: "Smoke Putus Base Item",
    sellingPrice: 50000,
    variants: null,
    stocks: [{ variantSku: "", qtyOnHand: 40, reservedQty: 0, avgCost: 18000 }],
  },
  {
    sku: "SMOKE-PUTUS-VARIANT",
    name: "Smoke Putus Variant Item",
    sellingPrice: 75000,
    variants: [
      { sku: "SMOKE-PUTUS-VARIANT-M", size: "M" },
      { sku: "SMOKE-PUTUS-VARIANT-L", size: "L" },
    ],
    stocks: [
      { variantSku: "SMOKE-PUTUS-VARIANT-M", qtyOnHand: 20, reservedQty: 0, avgCost: 25000 },
      { variantSku: "SMOKE-PUTUS-VARIANT-L", qtyOnHand: 20, reservedQty: 0, avgCost: 25000 },
    ],
  },
  {
    sku: "SMOKE-PUTUS-SHORT",
    name: "Smoke Putus Short Stock Item",
    sellingPrice: 30000,
    variants: null,
    stocks: [{ variantSku: "", qtyOnHand: 2, reservedQty: 0, avgCost: 10000 }],
  },
];

async function upsertInventory(itemId, stock) {
  const existingRows = await prisma.inventoryValue.findMany({
    where: { itemId },
    select: { id: true, variantSku: true },
  });
  const exact = existingRows.find((row) => (row.variantSku ?? "") === stock.variantSku);
  const totalValue = stock.qtyOnHand * stock.avgCost;
  if (exact) {
    return prisma.inventoryValue.update({
      where: { id: exact.id },
      data: {
        variantSku: stock.variantSku,
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
      name: "Smoke Test Putus Store",
      address: "Local Putus Smoke Test Address",
      termsType: "PUTUS",
      paymentTempo: 30,
      marginPercent: null,
      lat: -6.2,
      lng: 106.8,
      isActive: true,
    },
    create: {
      code: STORE_CODE,
      name: "Smoke Test Putus Store",
      address: "Local Putus Smoke Test Address",
      termsType: "PUTUS",
      paymentTempo: 30,
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
    const existing = await prisma.item.findUnique({
      where: { sku: product.sku },
      select: { id: true, _count: { select: { fieldSalesLines: true } } },
    });
    if (existing && existing._count.fieldSalesLines > 0) {
      throw new Error(`${product.sku} already has field-sales history; use a new fixture suffix`);
    }
    const item = await prisma.item.upsert({
      where: { sku: product.sku },
      update: {
        nameId: product.name,
        nameEn: product.name,
        type: "FINISHED_GOOD",
        uomId: uom.id,
        isActive: true,
        sellingPrice: product.sellingPrice,
        minOrderQty: 1,
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
        minOrderQty: 1,
        variants: product.variants,
        source: "ERP",
      },
    });
    for (const stock of product.stocks) {
      await upsertInventory(item.id, stock);
    }
    fixtureItems.push({ id: item.id, sku: item.sku });
  }

  const activePutusPromos = await prisma.promo.count({
    where: {
      isActive: true,
      termsType: "PUTUS",
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }] },
      ],
    },
  });
  const deliverPermission = await prisma.permission.findUnique({
    where: { code: "field_sales_orders:deliver" },
    select: { id: true },
  });
  const taxPermissions = await prisma.permission.count({
    where: { code: { in: ["tax_invoices:view", "tax_invoices:manage"] } },
  });
  const outboxAfter = await prisma.jubelioOutbox.count();

  console.log(JSON.stringify({
    store: { id: store.id, code: store.code, termsType: store.termsType },
    salesman: { id: salesman.id, email: salesman.email },
    items: fixtureItems,
    permissions: {
      deliver: Boolean(deliverPermission),
      taxInvoiceRows: taxPermissions,
    },
    activePutusPromos,
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
