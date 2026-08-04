/**
 * Inspect stores asdasd / TOKO-2 and related field-sales test data.
 * Usage: pnpm exec tsx scripts/inspect-test-stores.ts
 */
import "dotenv/config";

async function main() {
  const { prisma } = await import("@elorae/db");
  try {
    const stores = await prisma.store.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        isActive: true,
        termsType: true,
        createdAt: true,
        _count: {
          select: {
                visits: true,
                fieldSalesOrders: true,
                promoStores: true,
                storeChangeRequests: true,
                vanSales: true,
          },
        },
      },
    });
    console.log("=== All stores ===");
    for (const s of stores) {
      console.log(
        `${s.code} | ${s.name} | ${s.termsType} | active=${s.isActive} | orders=${s._count.fieldSalesOrders} visits=${s._count.visits} van=${s._count.vanSales} spg=${s._count.spgSales} promo=${s._count.promoStores} changeReq=${s._count.storeChangeRequests}`,
      );
    }

    const targets = stores.filter(
      (s) =>
        s.name.toLowerCase().includes("asdasd") ||
        s.code.toLowerCase().includes("asdasd") ||
        s.code.toUpperCase() === "TOKO-2" ||
        s.name.toUpperCase() === "TOKO-2" ||
        s.code.toUpperCase().includes("TOKO-2") ||
        s.name.toUpperCase().includes("TOKO-2"),
    );
    console.log("\n=== Targets ===");
    console.log(JSON.stringify(targets, null, 2));

    if (targets.length) {
      const ids = targets.map((t) => t.id);
      const orders = await prisma.fieldSalesOrder.findMany({
        where: { storeId: { in: ids } },
        select: {
          id: true,
          orderNo: true,
          status: true,
          orderType: true,
          storeId: true,
          _count: { select: { lines: true } },
        },
      });
      console.log(`\nFieldSalesOrders on targets: ${orders.length}`);
      for (const o of orders) {
        console.log(`  ${o.orderNo} ${o.orderType} ${o.status} lines=${o._count.lines}`);
      }

      // Also list ALL putus orders (test data?)
      const allPutus = await prisma.fieldSalesOrder.groupBy({
        by: ["status", "orderType"],
        _count: true,
      });
      console.log("\nAll FieldSalesOrder by status/type:", allPutus);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
