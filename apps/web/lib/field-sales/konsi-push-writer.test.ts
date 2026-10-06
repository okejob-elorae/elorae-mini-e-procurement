import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createKonsiPushOrder } from "./konsi-push-writer";
import { createSellThroughFixtures } from "@/lib/konsi-sell-through/test-fixtures";
import {
  createDeliveryShipment,
  updateShipmentTracking,
  shipDeliveryShipment,
  completeDeliveryShipment,
} from "@/lib/delivery/shipment-writer";

/* Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
/* Stubbed so no writer fan-out can queue push notifications on the shared dev DB. */
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

/* Every case drives real serializable writers end to end, well past vitest's 5s default. */
const SLOW = 60_000;

d("createKonsiPushOrder (test bed only)", () => {
  const fx = createSellThroughFixtures();
  const { state } = fx;

  beforeEach(fx.beforeEach);
  afterEach(fx.afterEach);

  const push = async (overrides: Partial<Parameters<typeof createKonsiPushOrder>[0]> = {}) => {
    const res = await createKonsiPushOrder({
      storeId: state.storeId,
      salesmanId: state.salesmanId,
      pushedById: state.userId,
      lines: [{ itemId: state.itemId, variantSku: "", qty: 3 }],
      idempotencyKey: crypto.randomUUID(),
      ...overrides,
    });
    state.orderIds.push(res.orderId);
    return res;
  };

  const inventory = () =>
    prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(state.itemId), OR: [{ variantSku: null }, { variantSku: "" }] } });

  it("creates an APPROVED konsi order pushed by the admin, reserving without moving stock", async () => {
    const before = await inventory();
    const { orderId, orderNo } = await push();
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: seededId(orderId) }, include: { lines: true } });
    expect(order).toMatchObject({
      orderNo,
      orderType: "KONSI",
      origin: "ADMIN",
      status: "APPROVED",
      visitId: null,
      salesmanId: state.salesmanId,
      approvedById: state.userId,
    });
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]).toMatchObject({ itemId: state.itemId, variantSku: "", qty: 3 });

    const after = await inventory();
    expect(Number(after.qtyOnHand)).toBe(Number(before.qtyOnHand));
    expect(Number(after.reservedQty)).toBe(Number(before.reservedQty) + 3);
    expect(await prisma.stockReservation.count({ where: { itemId: seededId(state.itemId), state: "RESERVED" } })).toBeGreaterThan(0);
    expect(await prisma.konsiTransfer.count({ where: { orderId: seededId(orderId) } })).toBe(0);
    expect(await prisma.storeStock.count({ where: { storeId: seededId(state.storeId) } })).toBe(0);
  }, SLOW);

  it("replays the same key to the same order, and a concurrent double submit creates one order", async () => {
    const key = crypto.randomUUID();
    const first = await push({ idempotencyKey: key });
    const again = await createKonsiPushOrder({
      storeId: state.storeId,
      salesmanId: state.salesmanId,
      pushedById: state.userId,
      lines: [{ itemId: state.itemId, variantSku: "", qty: 3 }],
      idempotencyKey: key,
    });
    expect(again).toEqual(first);

    const key2 = crypto.randomUUID();
    const input = {
      storeId: state.storeId,
      salesmanId: state.salesmanId,
      pushedById: state.userId,
      lines: [{ itemId: state.itemId, variantSku: "", qty: 1 }],
      idempotencyKey: key2,
    };
    const results = await Promise.allSettled([createKonsiPushOrder(input), createKonsiPushOrder(input)]);
    const ids = new Set(results.flatMap((r) => (r.status === "fulfilled" ? [r.value.orderId] : [])));
    for (const id of ids) state.orderIds.push(id);
    /* The loser's unique violation is answered with the winner, so both callers succeed. */
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(ids.size).toBe(1);
    expect(await prisma.fieldSalesOrder.count({ where: { idempotencyKey: key2 } })).toBe(1);
  }, SLOW);

  describe("replay compare", () => {
    const base = () => ({
      storeId: state.storeId,
      salesmanId: state.salesmanId,
      pushedById: state.userId,
    });

    it("answers the same lines in a different order with the first order, and ignores a changed note", async () => {
      const a = `TEST-KSTW-A-${state.run}`;
      const b = `TEST-KSTW-B-${state.run}`;
      await prisma.item.update({ where: { id: state.itemId }, data: { variants: [{ sku: a }, { sku: b }] } });
      for (const sku of [a, b]) {
        await prisma.inventoryValue.create({
          data: { itemId: state.itemId, variantSku: sku, qtyOnHand: 10, reservedQty: 0, avgCost: 10000, totalValue: 100000 },
        });
      }
      const key = crypto.randomUUID();
      const first = await push({
        idempotencyKey: key,
        note: "first",
        lines: [{ itemId: state.itemId, variantSku: a, qty: 1 }, { itemId: state.itemId, variantSku: b, qty: 2 }],
      });
      const again = await createKonsiPushOrder({
        ...base(),
        idempotencyKey: key,
        note: "second",
        lines: [{ itemId: state.itemId, variantSku: b, qty: 2 }, { itemId: state.itemId, variantSku: a, qty: 1 }],
      });
      expect(again).toEqual(first);
    }, SLOW);

    it("refuses a replay whose qty, lines or salesman changed, and creates no second order", async () => {
      const key = crypto.randomUUID();
      const first = await push({ idempotencyKey: key });
      const refused = { code: "REPLAY_MISMATCH", detail: first.orderNo };

      await expect(
        createKonsiPushOrder({ ...base(), idempotencyKey: key, lines: [{ itemId: state.itemId, variantSku: "", qty: 4 }] }),
      ).rejects.toMatchObject(refused);
      await expect(
        createKonsiPushOrder({
          ...base(),
          idempotencyKey: key,
          lines: [{ itemId: state.itemId, variantSku: "", qty: 3 }, { itemId: state.itemId, variantSku: "EXTRA", qty: 1 }],
        }),
      ).rejects.toMatchObject(refused);
      await expect(
        createKonsiPushOrder({ ...base(), salesmanId: state.userId, idempotencyKey: key, lines: [{ itemId: state.itemId, variantSku: "", qty: 3 }] }),
      ).rejects.toMatchObject(refused);
      expect(await prisma.fieldSalesOrder.count({ where: { idempotencyKey: key } })).toBe(1);
    }, SLOW);
  });

  it("refuses KEY_CONFLICT for a key already used at another store", async () => {
    const key = crypto.randomUUID();
    await push({ idempotencyKey: key });
    const other = await fx.otherStore();
    await prisma.store.update({ where: { id: other }, data: { termsType: "KONSI", isActive: true } });
    await expect(push({ storeId: other, idempotencyKey: key })).rejects.toMatchObject({ code: "KEY_CONFLICT" });
  }, SLOW);

  it("refuses a store that is not KONSI, not active or missing, and writes nothing", async () => {
    const orders = () => prisma.fieldSalesOrder.count({ where: { storeId: seededId(state.storeId) } });
    const n = await orders();
    await prisma.store.update({ where: { id: state.storeId }, data: { isActive: false } });
    await expect(push()).rejects.toMatchObject({ code: "STORE_INACTIVE" });
    await prisma.store.update({
      where: { id: state.storeId },
      data: { isActive: true, termsType: "PUTUS", sellThroughMethod: null, markupPercent: null },
    });
    await expect(push()).rejects.toMatchObject({ code: "NOT_KONSI" });
    await expect(push({ storeId: `missing-${state.run}` })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await orders()).toBe(n);
  }, SLOW);

  it("refuses a salesman who is not a candidate", async () => {
    await expect(push({ salesmanId: state.userId })).rejects.toMatchObject({ code: "SALESMAN_INVALID" });
  }, SLOW);

  it("refuses bad lines before any write", async () => {
    await expect(push({ lines: [] })).rejects.toMatchObject({ code: "NO_LINES" });
    await expect(push({ lines: [{ itemId: state.itemId, variantSku: "", qty: 0 }] })).rejects.toMatchObject({ code: "BAD_QTY" });
    await expect(push({ lines: [{ itemId: state.itemId, variantSku: "", qty: 1.5 }] })).rejects.toMatchObject({ code: "BAD_QTY" });
    await expect(
      push({ lines: [{ itemId: state.itemId, variantSku: "", qty: 1 }, { itemId: state.itemId, variantSku: "", qty: 2 }] }),
    ).rejects.toMatchObject({ code: "DUPLICATE", detail: `${state.itemId}::` });
    await expect(push({ lines: [{ itemId: `missing-${state.run}`, variantSku: "", qty: 1 }] })).rejects.toMatchObject({ code: "UNKNOWN_ITEM" });
    await expect(push({ lines: [{ itemId: state.itemId, variantSku: "NO-SUCH-VARIANT", qty: 1 }] })).rejects.toMatchObject({ code: "NO_INVENTORY" });
    expect(await prisma.fieldSalesOrder.count({ where: { storeId: seededId(state.storeId) } })).toBe(0);
  }, SLOW);

  it("refuses a short line with InsufficientStockError naming it, leaving no order or reservation", async () => {
    const inv = await inventory();
    const tooMany = Number(inv.qtyOnHand) - Number(inv.reservedQty) + 1;
    const reservedBefore = Number(inv.reservedQty);
    await expect(push({ lines: [{ itemId: state.itemId, variantSku: "", qty: tooMany }] })).rejects.toMatchObject({
      name: "InsufficientStockError",
      shortLines: [expect.objectContaining({ itemId: state.itemId })],
    });
    expect(await prisma.fieldSalesOrder.count({ where: { storeId: seededId(state.storeId) } })).toBe(0);
    expect(Number((await inventory()).reservedQty)).toBe(reservedBefore);
  }, SLOW);

  it("accepts a variantless line whose only stock row is keyed null", async () => {
    const inv = await inventory();
    await prisma.inventoryValue.update({ where: { id: inv.id }, data: { variantSku: null } });
    await expect(push()).resolves.toMatchObject({ orderNo: expect.any(String) });
  }, SLOW);

  it("takes only an item's own variant SKUs once it has SKU variants, never the pooled row", async () => {
    const sku = `TEST-KSTW-VAR-${state.run}`;
    /* The fixture's pooled "" row stays behind, which is exactly what a "" line must not reserve against. */
    await prisma.item.update({ where: { id: state.itemId }, data: { variants: [{ sku, color: "Red" }] } });
    await expect(push()).rejects.toMatchObject({ code: "NO_INVENTORY", detail: `${state.itemId}::` });
    await expect(push({ lines: [{ itemId: state.itemId, variantSku: "NO-SUCH-VARIANT", qty: 1 }] })).rejects.toMatchObject({
      code: "NO_INVENTORY",
      detail: `${state.itemId}::NO-SUCH-VARIANT`,
    });
    expect(await prisma.fieldSalesOrder.count({ where: { storeId: seededId(state.storeId) } })).toBe(0);

    await prisma.inventoryValue.create({
      data: { itemId: state.itemId, variantSku: sku, qtyOnHand: 10, reservedQty: 0, avgCost: 10000, totalValue: 100000 },
    });
    const { orderId } = await push({ lines: [{ itemId: state.itemId, variantSku: sku, qty: 2 }] });
    const line = await prisma.fieldSalesOrderLine.findFirstOrThrow({ where: { orderId: seededId(orderId) } });
    expect(line).toMatchObject({ itemId: state.itemId, variantSku: sku, qty: 2 });
    const variantRow = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(state.itemId), variantSku: sku } });
    expect(Number(variantRow.reservedQty)).toBe(2);
  }, SLOW);

  it("accepts an item already sent to the store", async () => {
    await push({ lines: [{ itemId: state.itemId, variantSku: "", qty: 1 }] });
    await expect(push({ lines: [{ itemId: state.itemId, variantSku: "", qty: 1 }] })).resolves.toMatchObject({ orderNo: expect.any(String) });
  }, SLOW);

  it("a pushed order ships and completes like any konsi order, landing the stock at the store", async () => {
    const { orderId } = await push({ lines: [{ itemId: state.itemId, variantSku: "", qty: 4 }] });
    const orderLine = await prisma.fieldSalesOrderLine.findFirstOrThrow({ where: { orderId: seededId(orderId) } });
    const { shipmentId } = await createDeliveryShipment({
      orderId,
      method: "EXPEDITION",
      lines: [{ orderLineId: orderLine.id, qty: 4 }],
      packedById: state.userId,
    });
    await updateShipmentTracking({ shipmentId, carrierName: "JNE", resiNumber: `RESI-PUSH-${state.run}` });
    await shipDeliveryShipment({ shipmentId, shippedById: state.userId });
    const shipment = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { lines: true } });
    await completeDeliveryShipment({
      shipmentId,
      deliveredById: state.userId,
      proofPhotoUrl: "https://r2.example/proof.jpg",
      proofPhotoR2Key: `delivery-proofs/${shipmentId}/goods.jpg`,
      lines: [{ shipmentLineId: shipment.lines[0].id, deliveredQty: 4 }],
    });
    expect(await prisma.konsiTransfer.count({ where: { orderId: seededId(orderId) } })).toBe(1);
    const stock = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(state.storeId), itemId: seededId(state.itemId) } });
    expect(Number(stock.qty)).toBe(4);
  }, SLOW);
});
