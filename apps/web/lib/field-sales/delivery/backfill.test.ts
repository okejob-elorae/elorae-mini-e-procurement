import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { computeDueDate } from "./plan";

const MIGRATION_SQL_PATH = resolve(
  __dirname,
  "../../../../../packages/db/prisma/migrations/20260809130000_backfill_field_sales_deliveries/migration.sql",
);

/**
 * This spec cannot invoke the backfill migration itself
 * (`packages/db/prisma/migrations/20260809130000_backfill_field_sales_deliveries/migration.sql`)
 * — vitest has no SQL runner, and that file only ever runs through `prisma migrate deploy`. What
 * it verifies instead is the *shape* the migration must leave behind: it seeds an order in the
 * exact pre-migration state every already-approved putus order was in (stock already consumed,
 * `SalesHistory` already written, no `FieldSalesDelivery` yet), replicates the migration's writes
 * through the Prisma client using the same values the SQL selects, and asserts the resulting
 * invariants. It does not prove the migration file itself runs correctly against a real database
 * — only that the state it is supposed to produce is internally consistent.
 */

/*
 * This one needs no database and skips for nobody: it reads the migration file as text, so it is
 * the only assertion in this file that can actually fail if `migration.sql` itself regresses (a
 * future edit re-introducing a write to a table the backfill must never touch). Every check below
 * it seeds and asserts Prisma-side state instead, which cannot detect that class of bug — see the
 * file-level comment.
 */
describe("field sales delivery backfill migration text", () => {
  it("never references the tables or columns a backfill must not touch", () => {
    /*
     * Strip `--` comment lines before scanning: the migration's own prose NAMES several of these
     * tokens while explaining the rule ("writes NO stock movement, NO StockAdjustment, and NO
     * SalesHistory") — that is documentation of the rule, not a violation of it, and scanning the
     * raw file would fail this test permanently on a migration that is doing exactly what it
     * should. The file has no trailing `--` on a statement line and no C-style block comments, so
     * a leading-`--` line filter is a complete comment strip for this specific file.
     *
     * Lower-case both sides before comparing: MariaDB table names are case-insensitive under
     * `lower_case_table_names=1`, so a statement written as INSERT INTO saleshistory (lowercase)
     * would pass a case-sensitive `.toContain("SalesHistory")` check while still writing to the
     * table.
     */
    const sql = readFileSync(MIGRATION_SQL_PATH, "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .toLowerCase();
    for (const forbidden of ["InventoryValue", "StockAdjustment", "SalesHistory", "qtyOnHand", "reservedQty"]) {
      expect(sql).not.toContain(forbidden.toLowerCase());
    }
  });
});

/* Stock-mutating fixtures — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("field sales delivery backfill shape (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let invId = "";
  let storeId = "";
  let salesmanId = "";
  let approverId = "";
  let orderId = "";
  let lineAId = "";
  let lineBId = "";
  let reservationAId = "";
  let reservationBId = "";
  let orderNo = "";
  let approvedAt = new Date();

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    invId = "";
    storeId = "";
    salesmanId = "";
    approverId = "";
    orderId = "";
    lineAId = "";
    lineBId = "";
    reservationAId = "";
    reservationBId = "";
    orderNo = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-BF-${token}`, nameId: "test", nameEn: "test" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-BF-${token}`, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId, sellingPrice: 1000 },
    });
    itemId = item.id;

    /* Stock already left the building at the original approve, long before delivery existed. */
    const inv = await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 5, reservedQty: 0, avgCost: 500, totalValue: 2500 },
    });
    invId = inv.id;

    const store = await prisma.store.create({
      data: { code: `TEST-BF-STORE-${token}`, name: "Test BF Store", address: "Test address", termsType: "PUTUS", paymentTempo: 14, isActive: true },
    });
    storeId = store.id;

    const salesman = await prisma.user.create({ data: { email: `test-bf-salesman-${token}@example.com`, name: "Test BF Salesman" } });
    salesmanId = salesman.id;
    const approver = await prisma.user.create({ data: { email: `test-bf-approver-${token}@example.com`, name: "Test BF Approver" } });
    approverId = approver.id;

    orderNo = `PUTUS/TEST-BF-${token}`;
    approvedAt = new Date("2026-06-01T03:00:00.000Z");

    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo,
        storeId,
        salesmanId,
        status: "APPROVED",
        orderType: "PUTUS",
        subtotal: 5000,
        total: 5000,
        approvedAt,
        approvedById: approverId,
        lines: {
          create: [
            { itemId, variantSku: "", productName: "Test BF Product A", qty: 3, unitPrice: 1000, lineTotal: 3000 },
            { itemId, variantSku: "", productName: "Test BF Product B", qty: 2, unitPrice: 1000, lineTotal: 2000 },
          ],
        },
      },
      include: { lines: true },
    });
    orderId = order.id;
    lineAId = order.lines.find((l) => l.productName === "Test BF Product A")!.id;
    lineBId = order.lines.find((l) => l.productName === "Test BF Product B")!.id;

    /* Reservations already CONSUMED at the original approve; consumedQty still at the Task-1 default (0). */
    const resA = await prisma.stockReservation.create({
      data: { source: "FIELD_SALES", fieldSalesLineId: lineAId, itemId, variantSku: "", qty: 3, state: "CONSUMED" },
    });
    reservationAId = resA.id;
    const resB = await prisma.stockReservation.create({
      data: { source: "FIELD_SALES", fieldSalesLineId: lineBId, itemId, variantSku: "", qty: 2, state: "CONSUMED" },
    });
    reservationBId = resB.id;

    /*
     * SalesHistory already written by the original approve, keyed by the order number — the same
     * key a backfilled delivery's docNo now deliberately borrows.
     */
    await prisma.salesHistory.create({
      data: {
        channel: "OFFLINE",
        orderId: orderNo,
        orderStatus: "COMPLETED",
        variantSku: "",
        parentSku: item.sku,
        productName: "Test BF Product A+B",
        quantity: 5,
        netQuantity: 5,
        unitPrice: 1000,
        unitPriceAfterDiscount: 1000,
        lineTotal: 5000,
        orderTotal: 5000,
        orderDate: approvedAt,
        completedDate: approvedAt,
        itemId,
      },
    });
  });

  afterEach(async () => {
    await prisma.salesHistory.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.inventoryValue.deleteMany({ where: { id: seededId(invId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(salesmanId), seededId(approverId)] } } });
  });

  it("leaves exactly one delivery mirroring the order, marks it fully delivered, and touches neither inventory nor sales history", async () => {
    const before = {
      inv: await prisma.inventoryValue.findUniqueOrThrow({ where: { id: invId } }),
      history: await prisma.salesHistory.findMany({ where: { itemId: seededId(itemId) }, orderBy: { id: "asc" } }),
    };

    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { lines: true, store: { select: { paymentTempo: true } } },
    });

    /*
     * Replicate the migration's writes through Prisma, using the same source values its SQL
     * selects (`o.orderNo` -> docNo, `o.approvedAt`/`approvedById` -> deliveredAt/deliveredById,
     * store paymentTempo -> dueDate). This is the "seed the post-migration state directly" step —
     * it does not execute migration.sql.
     */
    const delivery = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: order.orderNo,
        orderId: order.id,
        deliveredAt: order.approvedAt!,
        deliveredById: order.approvedById!,
        invoiceDate: order.approvedAt!,
        dueDate: computeDueDate(order.approvedAt!, order.store.paymentTempo),
        subtotal: order.subtotal,
        discountAmount: order.orderDiscountAmount,
        total: order.total,
        lines: {
          create: order.lines.map((l) => ({
            orderLineId: l.id,
            itemId: l.itemId,
            variantSku: l.variantSku,
            productName: l.productName,
            qty: l.qty,
            unitPrice: l.unitPrice,
            discountAmount: l.discountAmount,
            lineTotal: l.lineTotal,
          })),
        },
      },
      include: { lines: true },
    });

    for (const l of order.lines) {
      await prisma.fieldSalesOrderLine.update({ where: { id: l.id }, data: { deliveredQty: l.qty } });
    }
    await prisma.fieldSalesOrder.update({ where: { id: order.id }, data: { deliveryStatus: "DELIVERED" } });
    await prisma.stockReservation.update({ where: { id: reservationAId }, data: { consumedQty: 3 } });
    await prisma.stockReservation.update({ where: { id: reservationBId }, data: { consumedQty: 2 } });

    /* Exactly one delivery for the order, and it borrows the order's own number. */
    const deliveries = await prisma.fieldSalesDelivery.findMany({ where: { orderId: seededId(orderId) } });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].docNo).toBe(orderNo);
    expect(deliveries[0].id).toBe(delivery.id);

    /*
     * A backfilled delivery must age identically to one the app produces — pinned to the same
     * `computeDueDate` helper `recordFieldSalesDelivery` uses, not a re-derivation of its arithmetic.
     */
    expect(deliveries[0].dueDate).toEqual(computeDueDate(order.approvedAt!, order.store.paymentTempo));

    /* Delivery line quantities equal the order line quantities, one-for-one. */
    const deliveryLineByOrderLine = new Map(delivery.lines.map((dl) => [dl.orderLineId, dl]));
    expect(deliveryLineByOrderLine.get(lineAId)?.qty).toBe(3);
    expect(deliveryLineByOrderLine.get(lineBId)?.qty).toBe(2);

    /* Every order line reads fully delivered, and the order itself reads DELIVERED. */
    const lineA = await prisma.fieldSalesOrderLine.findUniqueOrThrow({ where: { id: lineAId } });
    const lineB = await prisma.fieldSalesOrderLine.findUniqueOrThrow({ where: { id: lineBId } });
    expect(lineA.deliveredQty).toBe(lineA.qty);
    expect(lineB.deliveredQty).toBe(lineB.qty);
    const reloadedOrder = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(reloadedOrder.deliveryStatus).toBe("DELIVERED");

    /* The reservations each line already consumed now report fully consumed. */
    const resA = await prisma.stockReservation.findUniqueOrThrow({ where: { id: reservationAId } });
    const resB = await prisma.stockReservation.findUniqueOrThrow({ where: { id: reservationBId } });
    expect(Number(resA.consumedQty)).toBe(Number(resA.qty));
    expect(Number(resB.consumedQty)).toBe(Number(resB.qty));

    /* Neither inventory nor sales history moved — the backfill documents the past, it doesn't redo it. */
    const after = {
      inv: await prisma.inventoryValue.findUniqueOrThrow({ where: { id: invId } }),
      history: await prisma.salesHistory.findMany({ where: { itemId: seededId(itemId) }, orderBy: { id: "asc" } }),
    };
    expect(Number(after.inv.qtyOnHand)).toBe(Number(before.inv.qtyOnHand));
    expect(Number(after.inv.reservedQty)).toBe(Number(before.inv.reservedQty));
    expect(Number(after.inv.totalValue)).toBe(Number(before.inv.totalValue));
    expect(after.history).toHaveLength(before.history.length);
    expect(after.history.map((h) => ({ id: h.id, quantity: h.quantity, lineTotal: Number(h.lineTotal) }))).toEqual(
      before.history.map((h) => ({ id: h.id, quantity: h.quantity, lineTotal: Number(h.lineTotal) })),
    );
  });
});
