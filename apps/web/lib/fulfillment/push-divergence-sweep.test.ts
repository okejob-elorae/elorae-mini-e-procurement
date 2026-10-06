import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { runFulfillmentPushDivergenceSweep } from "./push-divergence-sweep";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const HOUR_MS = 60 * 60 * 1000;
const CATEGORY = "FULFILLMENT_PUSH_STUCK";

async function notificationsFor(orderIds: string[]) {
  const rows = await prisma.adminNotification.findMany({
    where: { category: CATEGORY },
    select: { id: true, metadata: true },
  });
  return rows.filter((r) => orderIds.includes((r.metadata as { salesOrderId?: string } | null)?.salesOrderId ?? ""));
}

d("runFulfillmentPushDivergenceSweep (test bed only)", () => {
  let token = "";
  let counter = 0;
  let orderIds: string[] = [];
  let outboxIds: string[] = [];

  type OutboxSeed = {
    entityType: "salesorder_pick" | "salesorder_pack";
    status: string;
    skipReason?: string;
    createdAt?: Date;
  };

  async function addOutbox(orderId: string, outbox: OutboxSeed) {
    const row = await prisma.jubelioOutbox.create({
      data: {
        entityType: outbox.entityType,
        entityId: orderId,
        status: outbox.status,
        skipReason: outbox.skipReason ?? null,
        ...(outbox.createdAt ? { createdAt: outbox.createdAt } : {}),
      },
    });
    outboxIds.push(row.id);
    return row;
  }

  async function seedOrder(
    fulfillmentStatus: "PICKED" | "PACKED",
    outbox: OutboxSeed,
    orderOpts: { status?: "PROCESSING" | "CANCELLED"; createdAt?: Date } = {},
  ) {
    counter++;
    const order = await prisma.salesOrder.create({
      data: {
        salesorderId: -(Math.floor(Math.random() * 1_000_000_000) + counter),
        salesorderNo: `TEST-FPD-${token}-${counter}`,
        channel: "OTHER",
        sourceName: "test",
        status: orderOpts.status ?? "PROCESSING",
        ...(orderOpts.createdAt ? { createdAt: orderOpts.createdAt } : {}),
        subTotal: 0,
        totalDisc: 0,
        totalTax: 0,
        shippingCost: 0,
        grandTotal: 0,
        transactionDate: new Date(),
        fulfillmentStatus,
      },
    });
    orderIds.push(order.id);
    await addOutbox(order.id, outbox);
    return order;
  }

  beforeEach(() => {
    token = Math.random().toString(36).slice(2, 10);
    counter = 0;
    orderIds = [];
    outboxIds = [];
  });

  afterEach(async () => {
    const notifs = await notificationsFor(orderIds);
    if (notifs.length > 0) await prisma.adminNotification.deleteMany({ where: { id: { in: notifs.map((n) => n.id) } } });
    await prisma.jubelioOutbox.deleteMany({ where: { id: { in: outboxIds.map((id) => seededId(id)) } } });
    await prisma.salesOrder.deleteMany({ where: { id: { in: orderIds.map((id) => seededId(id)) } } });
  });

  it("notifies for a PACKED order whose pack push is DEAD", async () => {
    const order = await seedOrder("PACKED", { entityType: "salesorder_pack", status: "DEAD" });
    const result = await runFulfillmentPushDivergenceSweep({ orderIds: [order.id] });
    expect(result).toEqual({ checked: 1, notified: 1, failed: 0, deferred: 0 });
    expect(await notificationsFor([order.id])).toHaveLength(1);
  });

  it("does not notify for a PICKED order whose pick push is DONE", async () => {
    const order = await seedOrder("PICKED", { entityType: "salesorder_pick", status: "DONE" });
    const result = await runFulfillmentPushDivergenceSweep({ orderIds: [order.id] });
    expect(result.notified).toBe(0);
    expect(await notificationsFor([order.id])).toHaveLength(0);
  });

  it("does not notify when the pack push was SKIPPED because Jubelio is already in that state", async () => {
    const order = await seedOrder("PACKED", {
      entityType: "salesorder_pack",
      status: "SKIPPED",
      skipReason: "jubelio_already_in_state",
    });
    const result = await runFulfillmentPushDivergenceSweep({ orderIds: [order.id] });
    expect(result.notified).toBe(0);
  });

  it("notifies for a PICKED order whose pick push has been PENDING for 2 hours", async () => {
    const now = new Date();
    const order = await seedOrder("PICKED", {
      entityType: "salesorder_pick",
      status: "PENDING",
      createdAt: new Date(now.getTime() - 2 * HOUR_MS),
    });
    const result = await runFulfillmentPushDivergenceSweep({ orderIds: [order.id], now });
    expect(result.notified).toBe(1);
  });

  it("does not notify again on a second run", async () => {
    const order = await seedOrder("PACKED", { entityType: "salesorder_pack", status: "DEAD" });
    await runFulfillmentPushDivergenceSweep({ orderIds: [order.id] });
    const second = await runFulfillmentPushDivergenceSweep({ orderIds: [order.id] });
    expect(second.notified).toBe(0);
    expect(await notificationsFor([order.id])).toHaveLength(1);
  });

  it("an empty orderIds scope sweeps nothing", async () => {
    await seedOrder("PACKED", { entityType: "salesorder_pack", status: "DEAD" });
    const result = await runFulfillmentPushDivergenceSweep({ orderIds: [] });
    expect(result).toEqual({ checked: 0, notified: 0, failed: 0, deferred: 0 });
  });

  it("does not notify for a CANCELLED order whose pick push is DEAD", async () => {
    const order = await seedOrder("PICKED", { entityType: "salesorder_pick", status: "DEAD" }, { status: "CANCELLED" });
    const result = await runFulfillmentPushDivergenceSweep({ orderIds: [order.id] });
    expect(result).toEqual({ checked: 0, notified: 0, failed: 0, deferred: 0 });
    expect(await notificationsFor([order.id])).toHaveLength(0);
  });

  it("judges only the latest row: an older DEAD pack row under a newer DONE one does not notify", async () => {
    const now = new Date();
    const order = await seedOrder("PACKED", {
      entityType: "salesorder_pack",
      status: "DEAD",
      createdAt: new Date(now.getTime() - 2 * HOUR_MS),
    });
    await addOutbox(order.id, { entityType: "salesorder_pack", status: "DONE", createdAt: now });
    const result = await runFulfillmentPushDivergenceSweep({ orderIds: [order.id], now });
    expect(result.notified).toBe(0);
    expect(await notificationsFor([order.id])).toHaveLength(0);
  });

  it("notifies when the pick push was SKIPPED for a reason other than already-in-state", async () => {
    const order = await seedOrder("PICKED", {
      entityType: "salesorder_pick",
      status: "SKIPPED",
      skipReason: "no_pushable_lines",
    });
    const result = await runFulfillmentPushDivergenceSweep({ orderIds: [order.id] });
    expect(result.notified).toBe(1);
    expect(await notificationsFor([order.id])).toHaveLength(1);
  });

  it("does not notify for a pick push PENDING for less than the stuck threshold", async () => {
    const now = new Date();
    const order = await seedOrder("PICKED", {
      entityType: "salesorder_pick",
      status: "PENDING",
      createdAt: new Date(now.getTime() - 10 * 60 * 1000),
    });
    const result = await runFulfillmentPushDivergenceSweep({ orderIds: [order.id], now });
    expect(result.notified).toBe(0);
    expect(await notificationsFor([order.id])).toHaveLength(0);
  });

  it("caps new alerts per run, oldest orders first, and defers the rest", async () => {
    const now = new Date();
    const oldest = await seedOrder(
      "PACKED",
      { entityType: "salesorder_pack", status: "DEAD" },
      { createdAt: new Date(now.getTime() - 3 * HOUR_MS) },
    );
    const middle = await seedOrder(
      "PACKED",
      { entityType: "salesorder_pack", status: "DEAD" },
      { createdAt: new Date(now.getTime() - 2 * HOUR_MS) },
    );
    const newest = await seedOrder(
      "PACKED",
      { entityType: "salesorder_pack", status: "DEAD" },
      { createdAt: new Date(now.getTime() - HOUR_MS) },
    );
    const ids = [oldest.id, middle.id, newest.id];

    const first = await runFulfillmentPushDivergenceSweep({ orderIds: ids, now, maxAlerts: 2 });
    expect(first).toEqual({ checked: 3, notified: 2, failed: 0, deferred: 1 });
    expect(await notificationsFor([oldest.id, middle.id])).toHaveLength(2);
    expect(await notificationsFor([newest.id])).toHaveLength(0);

    const second = await runFulfillmentPushDivergenceSweep({ orderIds: ids, now, maxAlerts: 2 });
    expect(second).toEqual({ checked: 3, notified: 1, failed: 0, deferred: 0 });
    expect(await notificationsFor([newest.id])).toHaveLength(1);
  });
});
