/**
 * Remove test stores asdasd + TOKO-2 and their putus / visit test data.
 * Reverses FIELD_SALES stock effects (reserved + consumed) before delete.
 *
 * Dry-run by default:
 *   pnpm exec tsx scripts/cleanup-test-stores.ts
 * Apply:
 *   pnpm exec tsx scripts/cleanup-test-stores.ts --apply --confirm-prod-writes
 */
import "dotenv/config";

const TARGET_CODES = new Set(["asdasd", "TOKO-2"]);
const apply = process.argv.includes("--apply");
const confirm = process.argv.includes("--confirm-prod-writes");

function assertApplyAllowed(url: string): void {
  if (/:3308(\/|$)/.test(url)) return;
  if (/:(3306|3307)(\/|$)/.test(url)) {
    if (!confirm) {
      throw new Error(
        "Refusing write: prod-tunnel URL. Pass --confirm-prod-writes (and --apply).",
      );
    }
    console.warn("WARNING: writing against prod-tunnel DATABASE_URL.");
    return;
  }
  if (!confirm) {
    throw new Error("Refusing write: not local testbed. Pass --confirm-prod-writes.");
  }
}

/**
 * Consume adjustments are grouped per item, never per variant: StockAdjustment
 * carries no variantSku column, so the item id is the only key both sides of
 * the match share. Reservations that differ only by variant therefore land in
 * one bucket and are told apart by qtyChange further down.
 */
function invKey(itemId: string): string {
  return itemId;
}

async function main() {
  const { prisma } = await import("@elorae/db");
  const url = process.env.DATABASE_URL ?? "";
  console.log(`DATABASE_URL host peek: ${url.replace(/:[^:@/]+@/, ":****@").slice(0, 80)}…`);
  console.log(`mode: ${apply ? "APPLY" : "DRY-RUN"}`);

  try {
    const stores = await prisma.store.findMany({
      where: { code: { in: [...TARGET_CODES] } },
      select: {
        id: true,
        code: true,
        name: true,
        termsType: true,
      },
    });

    if (stores.length === 0) {
      console.log("No matching stores found.");
      return;
    }
    if (stores.some((s) => !TARGET_CODES.has(s.code))) {
      throw new Error("Unexpected store matched — abort.");
    }

    const storeIds = stores.map((s) => s.id);
    console.log("\nStores to remove:");
    for (const s of stores) console.log(`  ${s.code} | ${s.name} | ${s.termsType} | ${s.id}`);

    const orders = await prisma.fieldSalesOrder.findMany({
      where: { storeId: { in: storeIds } },
      include: {
        lines: {
          select: {
            id: true,
            itemId: true,
            variantSku: true,
            qty: true,
            productName: true,
          },
        },
      },
    });

    const lineIds = orders.flatMap((o) => o.lines.map((l) => l.id));
    const orderNos = orders.map((o) => o.orderNo);

    const reservations = lineIds.length
      ? await prisma.stockReservation.findMany({
          where: {
            fieldSalesLineId: { in: lineIds },
            source: { in: ["FIELD_SALES", "FIELD_SALES_KONSI"] },
          },
        })
      : [];

    const visits = await prisma.storeVisit.findMany({
      where: { storeId: { in: storeIds } },
      select: { id: true },
    });
    const visitIds = visits.map((v) => v.id);

    const photoCount = visitIds.length
      ? await prisma.visitPhoto.count({ where: { visitId: { in: visitIds } } })
      : 0;
    const changeReqCount = await prisma.storeChangeRequest.count({
      where: { storeId: { in: storeIds } },
    });
    const promoLinkCount = await prisma.promoStore.count({
      where: { storeId: { in: storeIds } },
    });
    const vanSaleCount = await prisma.vanSale.count({
      where: { storeId: { in: storeIds } },
    });
    // spgSale may be absent on older generated clients
    let spgSaleCount = 0;
    if ("spgSale" in prisma && typeof (prisma as { spgSale?: { count: Function } }).spgSale?.count === "function") {
      spgSaleCount = await (prisma as { spgSale: { count: (args: unknown) => Promise<number> } }).spgSale.count({
        where: { storeId: { in: storeIds } },
      });
    }

    const salesHistory = orderNos.length
      ? await prisma.salesHistory.findMany({
          where: { channel: "OFFLINE", orderId: { in: orderNos } },
          select: { id: true, orderId: true, quantity: true, productName: true },
        })
      : [];

    const consumeAdjs = orderNos.length
      ? await prisma.stockAdjustment.findMany({
          where: {
            source: "FIELD_SALES_CONSUME",
            OR: [
              ...orderNos.map((n) => ({ externalRef: `fieldsales:${n}` })),
              ...orderNos.map((n) => ({ idempotencyKey: { startsWith: `fieldsales-${n}-` } })),
              ...orderNos.map((n) => ({ reason: { contains: n } })),
            ],
          },
          select: {
            id: true,
            itemId: true,
            qtyChange: true,
            reason: true,
            prevAvgCost: true,
            externalRef: true,
          },
        })
      : [];

    const notifs = orderNos.length
      ? await prisma.adminNotification.findMany({
          where: {
            OR: [
              { category: "PENDING_ORDER_APPROVAL" },
              { title: { contains: "putus" } },
              ...orderNos.map((n) => ({ message: { contains: n } })),
              ...orderNos.map((n) => ({ title: { contains: n } })),
            ],
          },
          select: { id: true, category: true, title: true, message: true },
          take: 50,
        })
      : [];

    // Prefer notifications that mention our order numbers
    const relatedNotifs = notifs.filter((n) =>
      orderNos.some((no) => n.title.includes(no) || n.message.includes(no)),
    );

    console.log("\nRelated data:");
    console.log(`  FieldSalesOrder: ${orders.length}`);
    for (const o of orders) {
      console.log(
        `    ${o.orderNo} ${o.orderType} ${o.status} lines=${o.lines.length} total=${o.total}`,
      );
    }
    console.log(`  StockReservation: ${reservations.length}`);
    for (const r of reservations) {
      console.log(
        `    ${r.state} qty=${r.qty} item=${r.itemId} line=${r.fieldSalesLineId} source=${r.source}`,
      );
    }
    console.log(`  FIELD_SALES_CONSUME adjustments: ${consumeAdjs.length}`);
    for (const a of consumeAdjs) {
      console.log(`    ${a.id} qtyChange=${a.qtyChange} reason=${a.reason}`);
    }
    console.log(`  SalesHistory OFFLINE: ${salesHistory.length}`);
    console.log(`  StoreVisit: ${visits.length}`);
    console.log(`  VisitPhoto: ${photoCount}`);
    console.log(`  StoreChangeRequest: ${changeReqCount}`);
    console.log(`  PromoStore: ${promoLinkCount}`);
    console.log(`  VanSale: ${vanSaleCount}`);
    console.log(`  SpgSale: ${spgSaleCount}`);
    console.log(`  AdminNotification (order-related): ${relatedNotifs.length}`);

    if (vanSaleCount > 0 || spgSaleCount > 0) {
      throw new Error("Store has van/spg sales — refusing automated delete.");
    }

    if (!apply) {
      console.log("\nDry-run only. Re-run with --apply --confirm-prod-writes to delete.");
      return;
    }

    assertApplyAllowed(url);

    await prisma.$transaction(
      async (tx) => {
        // 1) Reverse RESERVED: decrement reservedQty, delete reservation rows
        for (const r of reservations.filter((x) => x.state === "RESERVED")) {
          const vs = r.variantSku || "";
          const inv = await tx.inventoryValue.findFirst({
            where: {
              itemId: r.itemId,
              OR: [{ variantSku: vs }, ...(vs === "" ? [{ variantSku: null }] : [])],
            },
          });
          if (inv) {
            await tx.inventoryValue.update({
              where: { id: inv.id },
              data: { reservedQty: { decrement: r.qty } },
            });
          }
          await tx.stockReservation.delete({ where: { id: r.id } });
          console.log(`  released RESERVED ${r.id} qty=${r.qty}`);
        }

        // 2) Reverse CONSUMED: restore qtyOnHand, delete consume adjustments + reservation
        const consumed = reservations.filter((x) => x.state === "CONSUMED");
        const adjByKey = new Map<string, typeof consumeAdjs>();
        for (const a of consumeAdjs) {
          const k = invKey(a.itemId);
          const list = adjByKey.get(k) ?? [];
          list.push(a);
          adjByKey.set(k, list);
        }

        for (const r of consumed) {
          const vs = r.variantSku || "";
          const qty = Number(r.qty);
          const inv = await tx.inventoryValue.findFirst({
            where: {
              itemId: r.itemId,
              OR: [{ variantSku: vs }, ...(vs === "" ? [{ variantSku: null }] : [])],
            },
          });

          // Delete matching FIELD_SALES_CONSUME row first (use its avgCost for totalValue restore)
          const k = invKey(r.itemId);
          const candidates = adjByKey.get(k) ?? [];
          const match =
            candidates.find((a) => Math.abs(Number(a.qtyChange)) === qty) ?? candidates[0];
          const avgCost = match ? Number(match.prevAvgCost) : inv ? Number(inv.avgCost) : 0;

          if (inv) {
            await tx.inventoryValue.update({
              where: { id: inv.id },
              data: {
                qtyOnHand: { increment: qty },
                totalValue: { increment: qty * avgCost },
                lastUpdated: new Date(),
              },
            });
          }

          if (match) {
            await tx.stockAdjustment.delete({ where: { id: match.id } });
            adjByKey.set(
              k,
              candidates.filter((c) => c.id !== match.id),
            );
            console.log(`  deleted consume adj ${match.id}`);
          } else {
            console.warn(`  WARN: no matching FIELD_SALES_CONSUME for reservation ${r.id}`);
          }

          await tx.stockReservation.delete({ where: { id: r.id } });
          console.log(`  reversed CONSUMED ${r.id} qty=${qty}`);
        }

        // Any leftover consume adjs that mention these order nos
        const leftoverAdjIds = [...adjByKey.values()].flat().map((a) => a.id);
        if (leftoverAdjIds.length) {
          await tx.stockAdjustment.deleteMany({ where: { id: { in: leftoverAdjIds } } });
          console.log(`  deleted leftover consume adjs: ${leftoverAdjIds.length}`);
        }

        // 3) SalesHistory for these order nos
        if (orderNos.length) {
          const sh = await tx.salesHistory.deleteMany({
            where: { channel: "OFFLINE", orderId: { in: orderNos } },
          });
          console.log(`  deleted SalesHistory: ${sh.count}`);
        }

        // 4) Notifications mentioning order nos
        if (relatedNotifs.length) {
          await tx.adminNotification.deleteMany({
            where: { id: { in: relatedNotifs.map((n) => n.id) } },
          });
          console.log(`  deleted AdminNotification: ${relatedNotifs.length}`);
        }

        // 5) Detach orders from visits, delete orders (lines cascade)
        if (orders.length) {
          await tx.fieldSalesOrder.updateMany({
            where: { id: { in: orders.map((o) => o.id) } },
            data: { visitId: null },
          });
          const delOrders = await tx.fieldSalesOrder.deleteMany({
            where: { id: { in: orders.map((o) => o.id) } },
          });
          console.log(`  deleted FieldSalesOrder: ${delOrders.count}`);
        }

        // 6) Photos, change requests, promo links
        if (visitIds.length) {
          const delPhotos = await tx.visitPhoto.deleteMany({
            where: { visitId: { in: visitIds } },
          });
          console.log(`  deleted VisitPhoto: ${delPhotos.count}`);
        }
        const delCr = await tx.storeChangeRequest.deleteMany({
          where: { storeId: { in: storeIds } },
        });
        console.log(`  deleted StoreChangeRequest: ${delCr.count}`);
        const delPromo = await tx.promoStore.deleteMany({
          where: { storeId: { in: storeIds } },
        });
        console.log(`  deleted PromoStore: ${delPromo.count}`);

        // 7) Visits
        const delVisits = await tx.storeVisit.deleteMany({
          where: { storeId: { in: storeIds } },
        });
        console.log(`  deleted StoreVisit: ${delVisits.count}`);

        // 8) Stores
        const delStores = await tx.store.deleteMany({
          where: { id: { in: storeIds } },
        });
        console.log(`  deleted Store: ${delStores.count}`);
      },
      { timeout: 60_000 },
    );

    console.log("\nDone.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
