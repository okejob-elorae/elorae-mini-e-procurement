import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "./index";
import { seededId } from "./spec-teardown";
import { consumeFieldSalesOrderPartial, PartialConsumeError } from "./reservation-writer";

/* Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("consumeFieldSalesOrderPartial (test bed only)", () => {
  let uomId = "";
  let itemId = "";
  let invId = "";
  let reservationId = "";
  const runId = Math.random().toString(36).slice(2, 10);
  const sku = `TEST-DLV-${runId}`;
  const lineId = `delivery-spec-line-${runId}`;

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    invId = "";
    reservationId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-${runId}`, nameId: "test", nameEn: "test" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId },
    });
    itemId = item.id;
    const inv = await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 10, reservedQty: 10, avgCost: 1000, totalValue: 10000 },
    });
    invId = inv.id;
    const res = await prisma.stockReservation.create({
      data: { source: "FIELD_SALES", fieldSalesLineId: lineId, itemId, variantSku: "", qty: 10, state: "RESERVED" },
    });
    reservationId = res.id;
  });

  afterEach(async () => {
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockReservation.deleteMany({ where: { id: seededId(reservationId) } });
    await prisma.inventoryValue.deleteMany({ where: { id: seededId(invId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("consumes only the delivered qty and leaves the reservation RESERVED", async () => {
    await consumeFieldSalesOrderPartial(prisma, {
      orderNo: "PUTUS/2026/9001",
      deliveryId: "dlv-1",
      lines: [{ fieldSalesLineId: lineId, itemId, variantSku: "", qty: 4 }],
    });

    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: invId } });
    expect(Number(inv.qtyOnHand)).toBe(6);
    expect(Number(inv.reservedQty)).toBe(6);
    expect(Number(inv.totalValue)).toBe(6000);

    const res = await prisma.stockReservation.findUniqueOrThrow({ where: { id: reservationId } });
    expect(res.state).toBe("RESERVED");
    expect(Number(res.consumedQty)).toBe(4);
  });

  it("flips the reservation to CONSUMED once the full qty is consumed", async () => {
    await consumeFieldSalesOrderPartial(prisma, {
      orderNo: "PUTUS/2026/9001",
      deliveryId: "dlv-1",
      lines: [{ fieldSalesLineId: lineId, itemId, variantSku: "", qty: 4 }],
    });
    await consumeFieldSalesOrderPartial(prisma, {
      orderNo: "PUTUS/2026/9001",
      deliveryId: "dlv-2",
      lines: [{ fieldSalesLineId: lineId, itemId, variantSku: "", qty: 6 }],
    });

    const res = await prisma.stockReservation.findUniqueOrThrow({ where: { id: reservationId } });
    expect(res.state).toBe("CONSUMED");
    expect(Number(res.consumedQty)).toBe(10);
    expect(res.resolvedAt).not.toBeNull();
  });

  it("rejects consuming more than the reservation holds and moves no stock", async () => {
    await expect(
      consumeFieldSalesOrderPartial(prisma, {
        orderNo: "PUTUS/2026/9001",
        deliveryId: "dlv-1",
        lines: [{ fieldSalesLineId: lineId, itemId, variantSku: "", qty: 11 }],
      }),
    ).rejects.toBeInstanceOf(PartialConsumeError);

    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: invId } });
    expect(Number(inv.qtyOnHand)).toBe(10);
  });

  it("hard-blocks when on-hand is below the requested qty and names the short line", async () => {
    await prisma.inventoryValue.update({ where: { id: invId }, data: { qtyOnHand: 2 } });

    const err = await consumeFieldSalesOrderPartial(prisma, {
      orderNo: "PUTUS/2026/9001",
      deliveryId: "dlv-1",
      lines: [{ fieldSalesLineId: lineId, itemId, variantSku: "", qty: 5 }],
    }).catch((e) => e);

    expect(err).toBeInstanceOf(PartialConsumeError);
    expect(err.code).toBe("INSUFFICIENT_STOCK");
    expect(err.shortLines).toEqual([{ fieldSalesLineId: lineId, itemId, variantSku: "", requested: 5, onHand: 2 }]);

    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: invId } });
    expect(Number(inv.qtyOnHand)).toBe(2);
  });

  it("writes one audited negative adjustment per delivery line", async () => {
    await consumeFieldSalesOrderPartial(prisma, {
      orderNo: "PUTUS/2026/9001",
      deliveryId: "dlv-1",
      lines: [{ fieldSalesLineId: lineId, itemId, variantSku: "", qty: 4 }],
    });

    const adj = await prisma.stockAdjustment.findMany({ where: { itemId: seededId(itemId) } });
    expect(adj).toHaveLength(1);
    expect(adj[0].source).toBe("FIELD_SALES_CONSUME");
    expect(Number(adj[0].qtyChange)).toBe(-4);
    expect(adj[0].idempotencyKey).toBe(`fieldsales-PUTUS/2026/9001-delivery-dlv-1-line-${lineId}`);
  });

  it("returns the per-line avgCost the consume actually used", async () => {
    const res = await consumeFieldSalesOrderPartial(prisma, {
      orderNo: "PUTUS/2026/9001",
      deliveryId: "dlv-1",
      lines: [{ fieldSalesLineId: lineId, itemId, variantSku: "", qty: 4 }],
    });

    expect(res.consumed).toBe(1);
    expect(res.lines).toEqual([{ fieldSalesLineId: lineId, qty: 4, avgCost: 1000 }]);
  });
});
