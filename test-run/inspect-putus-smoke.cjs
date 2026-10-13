const path = require("node:path");

const dbRoot = process.env.SMOKE_DB_PACKAGE_ROOT;
if (!dbRoot) {
  throw new Error("SMOKE_DB_PACKAGE_ROOT is required");
}

const { prisma } = require(path.join(dbRoot, "dist", "src", "index.js"));

async function main() {
  const store = await prisma.store.findUnique({
    where: { code: "SMOKE-PUTUS-20260814" },
    select: { id: true },
  });
  if (!store) throw new Error("PUTUS smoke store is missing");

  const orders = await prisma.fieldSalesOrder.findMany({
    where: { storeId: store.id },
    orderBy: { createdAt: "asc" },
    include: {
      lines: {
        include: {
          item: {
            select: {
              sku: true,
              inventoryValues: {
                select: {
                  variantSku: true,
                  qtyOnHand: true,
                  reservedQty: true,
                  avgCost: true,
                },
              },
            },
          },
        },
      },
      deliveries: {
        include: {
          lines: true,
          taxInvoice: true,
        },
      },
    },
  });

  const lineIds = orders.flatMap((order) => order.lines.map((line) => line.id));
  const reservations = lineIds.length
    ? await prisma.stockReservation.findMany({
      where: { fieldSalesLineId: { in: lineIds } },
      orderBy: { createdAt: "asc" },
    })
    : [];
  const deliveryDocNos = orders.flatMap((order) => order.deliveries.map((delivery) => delivery.docNo));
  const history = deliveryDocNos.length
    ? await prisma.salesHistory.findMany({
      where: { orderId: { in: deliveryDocNos } },
      orderBy: { createdAt: "asc" },
    })
    : [];
  const outboxCount = await prisma.jubelioOutbox.count();

  console.log(JSON.stringify({
    outboxCount,
    orders: orders.map((order) => ({
      id: order.id,
      orderNo: order.orderNo,
      orderType: order.orderType,
      status: order.status,
      deliveryStatus: order.deliveryStatus,
      subtotal: Number(order.subtotal),
      total: Number(order.total),
      approvedAt: order.approvedAt,
      rejectedAt: order.rejectedAt,
      rejectReason: order.rejectReason,
      lines: order.lines.map((line) => ({
        id: line.id,
        sku: line.item.sku,
        variantSku: line.variantSku,
        qty: line.qty,
        unitPrice: Number(line.unitPrice),
        lineTotal: Number(line.lineTotal),
        deliveredQty: line.deliveredQty,
        cancelledQty: line.cancelledQty,
        inventory: line.item.inventoryValues.map((row) => ({
          variantSku: row.variantSku,
          qtyOnHand: Number(row.qtyOnHand),
          reservedQty: Number(row.reservedQty),
          avgCost: Number(row.avgCost),
        })),
      })),
      deliveries: order.deliveries.map((delivery) => ({
        id: delivery.id,
        docNo: delivery.docNo,
        invoiceDate: delivery.invoiceDate,
        dueDate: delivery.dueDate,
        subtotal: Number(delivery.subtotal),
        discountAmount: Number(delivery.discountAmount),
        total: Number(delivery.total),
        lines: delivery.lines.map((line) => ({
          orderLineId: line.orderLineId,
          variantSku: line.variantSku,
          qty: line.qty,
          lineTotal: line.lineTotal === null ? null : Number(line.lineTotal),
        })),
        taxInvoice: delivery.taxInvoice && {
          status: delivery.taxInvoice.status,
          invoiceNo: delivery.taxInvoice.invoiceNo,
          notaPrintedAt: delivery.taxInvoice.notaPrintedAt,
        },
      })),
    })),
    reservations: reservations.map((row) => ({
      fieldSalesLineId: row.fieldSalesLineId,
      source: row.source,
      variantSku: row.variantSku,
      qty: Number(row.qty),
      consumedQty: Number(row.consumedQty),
      state: row.state,
    })),
    salesHistory: history.map((row) => ({
      orderId: row.orderId,
      variantSku: row.variantSku,
      quantity: row.quantity,
      unitPrice: Number(row.unitPrice),
      lineTotal: Number(row.lineTotal),
      orderTotal: Number(row.orderTotal),
      channel: row.channel,
    })),
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
