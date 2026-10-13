const path = require("node:path");
const { createRequire } = require("node:module");

const dbRoot = process.env.SMOKE_DB_PACKAGE_ROOT;
if (!dbRoot) {
  throw new Error("SMOKE_DB_PACKAGE_ROOT is required");
}

const requireFromDb = createRequire(path.join(dbRoot, "package.json"));
const { prisma } = require(path.join(dbRoot, "dist", "src", "index.js"));

async function resetPendingOrder({ orderNo, note, storeId, salesmanId, visitId, item, qty }) {
  const existing = await prisma.fieldSalesOrder.findUnique({
    where: { orderNo },
    select: { id: true },
  });
  if (existing) {
    await prisma.stockReservation.deleteMany({
      where: { fieldSalesLineId: { in: (await prisma.fieldSalesOrderLine.findMany({
        where: { orderId: existing.id },
        select: { id: true },
      })).map((line) => line.id) } },
    });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: existing.id } });
    await prisma.fieldSalesOrder.update({
      where: { id: existing.id },
      data: {
        status: "PENDING_APPROVAL",
        subtotal: 0,
        total: 0,
        approvedAt: null,
        approvedById: null,
        rejectedAt: null,
        rejectedById: null,
        rejectReason: null,
        note,
        visitId,
        lines: {
          create: {
            itemId: item.id,
            variantSku: "",
            productName: item.nameEn,
            qty,
            unitPrice: 0,
            lineTotal: 0,
          },
        },
      },
    });
    return existing.id;
  }

  const order = await prisma.fieldSalesOrder.create({
    data: {
      orderNo,
      storeId,
      salesmanId,
      visitId,
      status: "PENDING_APPROVAL",
      orderType: "KONSI",
      subtotal: 0,
      total: 0,
      note,
      lines: {
        create: {
          itemId: item.id,
          variantSku: "",
          productName: item.nameEn,
          qty,
          unitPrice: 0,
          lineTotal: 0,
        },
      },
    },
  });
  return order.id;
}

async function main() {
  const store = await prisma.store.findUniqueOrThrow({
    where: { code: "SMOKE-KONSI-20260814" },
  });
  const salesman = await prisma.user.findUniqueOrThrow({
    where: { email: "salesman@elorae.com" },
  });
  const visit = await prisma.storeVisit.findFirstOrThrow({
    where: { storeId: store.id, userId: salesman.id, checkoutAt: null },
    orderBy: { checkinAt: "desc" },
  });
  const baseItem = await prisma.item.findUniqueOrThrow({
    where: { sku: "SMOKE-KONSI-BASE" },
  });
  const suggestionItem = await prisma.item.findUniqueOrThrow({
    where: { sku: "SMOKE-KONSI-SUGGEST" },
  });

  const insufficientId = await resetPendingOrder({
    orderNo: "KONSI/SMOKE/INSUFFICIENT",
    note: "SMOKE NEGATIVE — insufficient stock",
    storeId: store.id,
    salesmanId: salesman.id,
    visitId: visit.id,
    item: baseItem,
    qty: 99,
  });
  const rejectId = await resetPendingOrder({
    orderNo: "KONSI/SMOKE/REJECT",
    note: "SMOKE NEGATIVE — reject path",
    storeId: store.id,
    salesmanId: salesman.id,
    visitId: visit.id,
    item: suggestionItem,
    qty: 1,
  });

  console.log(JSON.stringify({ insufficientId, rejectId }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
