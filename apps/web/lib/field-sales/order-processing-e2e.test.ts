import { describe, it, expect, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@elorae/db";
import { createFieldSalesOrder } from "./writer";
import { createDeliveryShipment } from "@/lib/delivery/shipment-writer";

/*
 * Opt-in edge-case driver for the order processing card. Runs only with OPE_E2E=1 against the
 * :3308 test bed and leaves its rows in place (every code carries the run token) so the browser
 * checks can open them.
 */
const url = process.env.DATABASE_URL ?? "";
const enabled = process.env.OPE_E2E === "1" && url.includes(":3308");
const d = enabled ? describe : describe.skip;

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

import { approveFieldSalesOrderAction, rejectFieldSalesOrderAction } from "@/app/actions/field-sales-orders";
import {
  recordDeliveryAction,
  closeRemainderAction,
  updateDeliveryDatesAction,
  recordNotaTagihanPrinted,
} from "@/app/actions/field-sales-deliveries";

type Row = { id: string; result: "PASS" | "FAIL" | "NOTE"; note: string };
const report: Row[] = [];
function check(id: string, ok: boolean, note: string) {
  report.push({ id, result: ok ? "PASS" : "FAIL", note });
}
function note(id: string, text: string) {
  report.push({ id, result: "NOTE", note: text });
}
async function attempt<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: unknown }> {
  try {
    return { value: await fn() };
  } catch (error) {
    return { error };
  }
}
function errText(e: unknown): string {
  const s = e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e);
  return s.replace(/\s+/g, " ").slice(0, 160);
}

const run = Date.now().toString(36).slice(-8);
const ids: Record<string, string> = {};
const ALL = [
  "field_sales_orders:view",
  "field_sales_orders:approve",
  "field_sales_orders:deliver",
  "field_sales_orders:credit_override",
];
let adminId = "";
let salesmanId = "";
let uomId = "";

function asAdmin(perms: string[] = ALL) {
  mockAuth.mockResolvedValue({ user: { id: adminId, permissions: perms } });
}

async function mkItem(tag: string, price: number | null, onHand: number) {
  const item = await prisma.item.create({
    data: { sku: `OPE-${run}-${tag}`, nameId: `OPE ${tag}`, nameEn: `OPE ${tag}`, type: "FINISHED_GOOD", isActive: true, uomId, sellingPrice: price },
  });
  if (onHand >= 0) {
    await prisma.inventoryValue.create({
      data: { itemId: item.id, variantSku: null, qtyOnHand: onHand, reservedQty: 0, avgCost: 40000, totalValue: onHand * 40000 },
    });
  }
  ids[`item_${tag}`] = item.id;
  return item.id;
}

async function mkStore(tag: string, terms: "PUTUS" | "KONSI", creditLimit: number | null = null) {
  const store = await prisma.store.create({
    data: {
      code: `OPE-${run}-${tag}`,
      name: `OPE ${tag} ${run}`,
      address: "Test",
      termsType: terms,
      paymentTempo: 30,
      isActive: true,
      creditLimit,
      markupPercent: terms === "KONSI" ? 25 : null,
    },
  });
  await prisma.storeVisit.create({ data: { storeId: store.id, userId: salesmanId, checkinLat: 0, checkinLng: 0 } });
  ids[`store_${tag}`] = store.id;
  return store.id;
}

async function order(storeId: string, lines: Array<{ itemId: string; qty: number; requestedUnitPrice?: number }>) {
  const r = await createFieldSalesOrder({
    storeId,
    salesmanId,
    skipMinQty: true,
    lines: lines.map((l) => ({
      itemId: l.itemId,
      variantSku: "",
      productName: "OPE",
      qty: l.qty,
      unitPrice: 0,
      requestedUnitPrice: l.requestedUnitPrice ?? null,
      appealReason: l.requestedUnitPrice ? "OPE appeal" : null,
    })),
  });
  return r;
}

async function linesOf(orderId: string) {
  return prisma.fieldSalesOrderLine.findMany({ where: { orderId }, orderBy: { id: "asc" } });
}
async function onHand(itemId: string) {
  const inv = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId, OR: [{ variantSku: null }, { variantSku: "" }] } });
  return { onHand: Number(inv.qtyOnHand), reserved: Number(inv.reservedQty) };
}

const INV = "2026-09-30";
const DUE = "2026-10-30";

d("order processing — end to end (opt-in)", () => {
  it("setup", async () => {
    adminId = (await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } })).id;
    salesmanId = (await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } })).id;
    uomId = (await prisma.uOM.create({ data: { code: `OPE-${run}`, nameId: "pcs", nameEn: "pcs" } })).id;
    ids.admin = adminId;
    ids.salesman = salesmanId;
    await mkItem("A", 100000, 100);
    await mkItem("B", 50000, 100);
    await mkItem("SHORT", 70000, 3);
    await mkItem("K1", 80000, 50);
    await mkItem("K2", 60000, 50);
    await mkItem("KNEW", 90000, 20);
    await mkItem("KNOINV", 90000, -1);
    await mkItem("KSENT", 90000, 20);
    await mkStore("P", "PUTUS");
    await mkStore("CR", "PUTUS", 300000);
    await mkStore("K", "KONSI");
    asAdmin();
  });

  it("A — putus approve / reject", async () => {
    const P = ids.store_P;
    const A = ids.item_A;
    const B = ids.item_B;

    // A-01 appealed line repriced, stray final price ignored
    const o1 = await order(P, [{ itemId: A, qty: 2, requestedUnitPrice: 90000 }, { itemId: B, qty: 2 }]);
    ids.order_A01 = o1.orderId;
    const [l1a, l1b] = await linesOf(o1.orderId);
    const r1 = await approveFieldSalesOrderAction(o1.orderId, [
      { lineId: l1a.id, finalUnitPrice: 95000 },
      { lineId: l1b.id, finalUnitPrice: 1 },
    ]);
    const after1 = await linesOf(o1.orderId);
    const o1Row = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: o1.orderId } });
    check(
      "A-01",
      r1.ok && Number(after1[0].unitPrice) === 95000 && Number(after1[1].unitPrice) === 50000 && Number(o1Row.total) === 290000,
      `appealed 100000→95000, stray ignored (${Number(after1[1].unitPrice)}), total ${Number(o1Row.total)}`,
    );

    // A-02 approve twice / approve after reject
    const r2 = await approveFieldSalesOrderAction(o1.orderId);
    const o2 = await order(P, [{ itemId: B, qty: 1 }]);
    await rejectFieldSalesOrderAction(o2.orderId, "OPE reject");
    const r2b = await approveFieldSalesOrderAction(o2.orderId);
    check("A-02", r2.ok && !r2b.ok && r2b.reason === "INVALID_TRANSITION", `second approve ok; approve after reject ${r2b.ok ? "ok" : r2b.reason}`);

    // A-03 reject releases, reject twice ok, reject approved refused
    const before3 = await onHand(B);
    const o3 = await order(P, [{ itemId: B, qty: 4 }]);
    const mid3 = await onHand(B);
    const r3 = await rejectFieldSalesOrderAction(o3.orderId, "OPE reject 3");
    const r3b = await rejectFieldSalesOrderAction(o3.orderId, "again");
    const after3 = await onHand(B);
    const o3LineIds = (await linesOf(o3.orderId)).map((l) => l.id);
    const res3 = await prisma.stockReservation.findMany({ where: { fieldSalesLineId: { in: o3LineIds } } });
    const r3c = await rejectFieldSalesOrderAction(o1.orderId, "reject approved");
    check(
      "A-03",
      r3.ok && r3b.ok && mid3.reserved === before3.reserved + 4 && after3.reserved === before3.reserved && after3.onHand === before3.onHand &&
        res3.every((r) => r.state === "RELEASED") && !r3c.ok && r3c.reason === "INVALID_TRANSITION",
      `reserved ${before3.reserved}→${mid3.reserved}→${after3.reserved}, on-hand ${after3.onHand}, reject approved ${r3c.ok ? "ok" : r3c.reason}`,
    );

    // A-04 blank reason through the action
    const o4 = await order(P, [{ itemId: B, qty: 1 }]);
    ids.order_A04 = o4.orderId;
    const r4 = await rejectFieldSalesOrderAction(o4.orderId, "   ");
    const o4Row = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: o4.orderId } });
    check("A-04", !r4.ok && o4Row.status === "PENDING_APPROVAL", `blank reason → ${r4.ok ? "REJECTED with reason " + JSON.stringify(o4Row.rejectReason) : r4.reason}`);
    if (o4Row.status === "PENDING_APPROVAL") await rejectFieldSalesOrderAction(o4.orderId, "OPE cleanup");

    // A-09 addedLines on putus; A-10 malformed final prices
    const o9 = await order(P, [{ itemId: B, qty: 1 }]);
    const r9 = await approveFieldSalesOrderAction(o9.orderId, undefined, [{ itemId: A, variantSku: "", qty: 1 }]);
    check("A-09", !r9.ok && r9.reason === "INVALID_ADDED_LINE" && r9.addedLineCode === "NOT_KONSI", `${r9.ok ? "ok" : r9.reason + "/" + r9.addedLineCode}`);
    const [l9] = await linesOf(o9.orderId);
    const r10a = await approveFieldSalesOrderAction(o9.orderId, [{ lineId: l9.id, finalUnitPrice: -1 }]);
    const r10b = await approveFieldSalesOrderAction(o9.orderId, [{ lineId: l9.id, finalUnitPrice: Number.NaN }]);
    check("A-10", !r10a.ok && r10a.reason === "INVALID_FINAL_PRICE" && !r10b.ok && r10b.reason === "INVALID_FINAL_PRICE", "negative / NaN → INVALID_FINAL_PRICE");
    await rejectFieldSalesOrderAction(o9.orderId, "OPE cleanup");
  });

  it("A — credit limit gate", async () => {
    const CR = ids.store_CR;
    const A = ids.item_A;
    // limit 300000; order 4 × 100000 = 400000
    const o5 = await order(CR, [{ itemId: A, qty: 4, requestedUnitPrice: 90000 }]);
    ids.order_A05 = o5.orderId;
    const [l5] = await linesOf(o5.orderId);
    const r5 = await approveFieldSalesOrderAction(o5.orderId, [{ lineId: l5.id, finalUnitPrice: 95000 }]);
    const [l5after] = await linesOf(o5.orderId);
    const o5Row = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: o5.orderId } });
    check(
      "A-05",
      !r5.ok && r5.reason === "CREDIT_LIMIT_EXCEEDED" && o5Row.status === "PENDING_APPROVAL" && Number(l5after.unitPrice) === 100000,
      `${r5.ok ? "ok" : r5.reason} exposure ${r5.ok ? "-" : JSON.stringify(r5.credit)}; status ${o5Row.status}, line price ${Number(l5after.unitPrice)}`,
    );

    asAdmin(ALL.filter((p) => p !== "field_sales_orders:credit_override"));
    const r6 = await approveFieldSalesOrderAction(o5.orderId, undefined, undefined, "Owner agreed");
    asAdmin();
    check("A-06", !r6.ok && r6.reason === "FORBIDDEN", `${r6.ok ? "ok" : r6.reason}`);

    const r7 = await approveFieldSalesOrderAction(o5.orderId, undefined, undefined, "Owner agreed");
    const o7Row = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: o5.orderId } });
    const audits = await prisma.auditLog.count({ where: { entityId: o5.orderId, action: "CREDIT_LIMIT_OVERRIDE" } });
    check(
      "A-07",
      r7.ok && o7Row.status === "APPROVED" && o7Row.creditOverrideReason === "Owner agreed" && Number(o7Row.creditLimitAtApprove) === 300000 && audits === 1,
      `approved with override, snapshot limit ${Number(o7Row.creditLimitAtApprove)}, exposure ${Number(o7Row.creditExposureAtApprove)}, audit rows ${audits}`,
    );

    const o8 = await order(CR, [{ itemId: A, qty: 4 }]);
    const long = "x".repeat(250);
    const r8 = await attempt(() => approveFieldSalesOrderAction(o8.orderId, undefined, undefined, long));
    const o8Row = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: o8.orderId } });
    const audit8 = await prisma.auditLog.findFirst({ where: { entityId: o8.orderId, action: "CREDIT_LIMIT_OVERRIDE" } });
    check(
      "A-08",
      r8.error === undefined && (r8.value?.ok === false || (o8Row.status === "APPROVED" && audit8 !== null)),
      r8.error ? `250-char override reason threw ${errText(r8.error)}` : `result ${JSON.stringify(r8.value)}, status ${o8Row.status}, order keeps ${o8Row.creditOverrideReason?.length} chars, audit reason ${audit8?.reason?.length ?? "-"} chars`,
    );
  });

  it("B — delivery, partial delivery, remainder", async () => {
    const P = ids.store_P;
    const A = ids.item_A;
    const B = ids.item_B;
    const o = await order(P, [{ itemId: A, qty: 5 }, { itemId: B, qty: 4 }]);
    ids.order_B = o.orderId;
    ids.orderNo_B = o.orderNo;
    await approveFieldSalesOrderAction(o.orderId);
    const [la, lb] = await linesOf(o.orderId);

    // B-08 wrong states
    const pending = await order(P, [{ itemId: B, qty: 1 }]);
    const r8a = await recordDeliveryAction({ orderId: pending.orderId, lines: [{ orderLineId: (await linesOf(pending.orderId))[0].id, qty: 1 }], invoiceDate: INV, dueDate: DUE, idempotencyKey: randomUUID() });
    await rejectFieldSalesOrderAction(pending.orderId, "OPE");
    const r8b = await recordDeliveryAction({ orderId: pending.orderId, lines: [{ orderLineId: (await linesOf(pending.orderId))[0].id, qty: 1 }], invoiceDate: INV, dueDate: DUE, idempotencyKey: randomUUID() });
    check("B-08 putus", !r8a.ok && r8a.reason === "INVALID_STATE" && !r8b.ok && r8b.reason === "INVALID_STATE", `pending ${r8a.ok ? "ok" : r8a.reason}, rejected ${r8b.ok ? "ok" : r8b.reason}`);

    // B-03 / B-04 quantities
    const r3a = await recordDeliveryAction({ orderId: o.orderId, lines: [{ orderLineId: la.id, qty: 6 }], invoiceDate: INV, dueDate: DUE, idempotencyKey: randomUUID() });
    const r3b = await recordDeliveryAction({ orderId: o.orderId, lines: [{ orderLineId: la.id, qty: 3 }, { orderLineId: la.id, qty: 3 }], invoiceDate: INV, dueDate: DUE, idempotencyKey: randomUUID() });
    check("B-03", !r3a.ok && r3a.reason === "OVER_DELIVER" && !r3b.ok && r3b.reason === "OVER_DELIVER", "6 of 5 / 3+3 of 5 → OVER_DELIVER");
    const q = [0, -1, 1.5];
    const r4 = await Promise.all(q.map((qty) => recordDeliveryAction({ orderId: o.orderId, lines: [{ orderLineId: la.id, qty }], invoiceDate: INV, dueDate: DUE, idempotencyKey: randomUUID() })));
    check("B-04", r4.every((r) => !r.ok && r.reason === "INVALID_REQUEST"), `0 / −1 / 1.5 → ${r4.map((r) => (r.ok ? "ok" : r.reason)).join(" / ")}`);

    // B-05 dates, B-06 keys
    const r5a = await recordDeliveryAction({ orderId: o.orderId, lines: [{ orderLineId: la.id, qty: 1 }], invoiceDate: DUE, dueDate: INV, idempotencyKey: randomUUID() });
    const r5b = await recordDeliveryAction({ orderId: o.orderId, lines: [{ orderLineId: la.id, qty: 1 }], invoiceDate: "2026-02-30", dueDate: DUE, idempotencyKey: randomUUID() });
    const r5c = await recordDeliveryAction({ orderId: o.orderId, lines: [{ orderLineId: la.id, qty: 1 }], invoiceDate: 20260930 as unknown as string, dueDate: DUE, idempotencyKey: randomUUID() });
    check(
      "B-05",
      !r5a.ok && r5a.reason === "INVALID_DATES" && !r5b.ok && r5b.reason === "INVALID_REQUEST" && !r5c.ok && r5c.reason === "INVALID_REQUEST",
      `inverted ${r5a.ok ? "ok" : r5a.reason}, 2026-02-30 ${r5b.ok ? "ok" : r5b.reason}, number ${r5c.ok ? "ok" : r5c.reason}`,
    );
    const r6a = await recordDeliveryAction({ orderId: o.orderId, lines: [{ orderLineId: la.id, qty: 1 }], invoiceDate: INV, dueDate: DUE, idempotencyKey: "" });
    const r6b = await recordDeliveryAction({ orderId: o.orderId, lines: [{ orderLineId: la.id, qty: 1 }], invoiceDate: INV, dueDate: DUE, idempotencyKey: "k".repeat(65) });
    check("B-06", !r6a.ok && r6a.reason === "INVALID_REQUEST" && !r6b.ok && r6b.reason === "INVALID_REQUEST", "blank / 65-char key → INVALID_REQUEST");

    // B-01 partial delivery
    const stockBefore = await onHand(A);
    const key1 = randomUUID();
    const r1 = await recordDeliveryAction({ orderId: o.orderId, lines: [{ orderLineId: la.id, qty: 2 }], invoiceDate: INV, dueDate: DUE, idempotencyKey: key1 });
    const deliveries1 = await prisma.fieldSalesDelivery.findMany({ where: { orderId: o.orderId } });
    const d1 = deliveries1[0];
    const tax1 = d1 ? await prisma.taxInvoice.count({ where: { deliveryId: d1.id } }) : 0;
    const ar1 = d1 ? await prisma.receivable.findMany({ where: { deliveryId: d1.id } }) : [];
    const oRow1 = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: o.orderId } });
    const stockAfter = await onHand(A);
    ids.delivery1 = d1?.id ?? "";
    check(
      "B-01",
      r1.ok && deliveries1.length === 1 && oRow1.deliveryStatus === "PARTIAL" && tax1 === 1 && ar1.length === 1 &&
        Number(ar1[0].originalAmount) === 200000 && stockAfter.onHand === stockBefore.onHand - 2 &&
        d1.dueDate.toISOString() === "2026-10-29T17:00:00.000Z",
      `${d1?.docNo}: PARTIAL, 1 faktur, 1 receivable ${Number(ar1[0]?.originalAmount)}, on-hand ${stockBefore.onHand}→${stockAfter.onHand}, due ${d1?.dueDate.toISOString()}`,
    );

    // B-07 replay
    const r7a = await recordDeliveryAction({ orderId: o.orderId, lines: [{ orderLineId: la.id, qty: 2 }], invoiceDate: INV, dueDate: DUE, idempotencyKey: key1 });
    const r7b = await recordDeliveryAction({ orderId: o.orderId, lines: [{ orderLineId: la.id, qty: 3 }], invoiceDate: INV, dueDate: DUE, idempotencyKey: key1 });
    const count7 = await prisma.fieldSalesDelivery.count({ where: { orderId: o.orderId } });
    check(
      "B-07",
      r7a.ok && !r7b.ok && r7b.reason === "REPLAY_MISMATCH" && r7b.replay?.docNo === d1.docNo && count7 === 1 && (await onHand(A)).onHand === stockAfter.onHand,
      `same payload → same doc; changed qty → ${r7b.ok ? "ok" : r7b.reason} carrying ${r7b.ok ? "-" : r7b.replay?.docNo}; deliveries ${count7}`,
    );

    // B-16 correct dates happy path, B-14 refusals, B-15 long reason
    const r16 = await updateDeliveryDatesAction({ deliveryId: d1.id, invoiceDate: "2026-09-29", dueDate: "2026-11-15", reason: "OPE date fix" });
    const d1b = await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: d1.id } });
    const ar1b = await prisma.receivable.findFirstOrThrow({ where: { deliveryId: d1.id } });
    const audit16 = await prisma.auditLog.count({ where: { entityId: d1.id, action: "UPDATE_DELIVERY_DATES" } });
    check(
      "B-16",
      r16.ok && d1b.docNo === d1.docNo && d1b.dueDate.getTime() === ar1b.dueDate.getTime() && d1b.invoiceDate.getTime() === ar1b.invoiceDate.getTime() && audit16 === 1,
      `delivery + receivable moved together, docNo kept ${d1b.docNo}, audit rows ${audit16}`,
    );
    const r14a = await updateDeliveryDatesAction({ deliveryId: d1.id, invoiceDate: INV, dueDate: DUE, reason: "  " });
    const r14b = await updateDeliveryDatesAction({ deliveryId: d1.id, invoiceDate: DUE, dueDate: INV, reason: "x" });
    const r15 = await attempt(() => updateDeliveryDatesAction({ deliveryId: d1.id, invoiceDate: INV, dueDate: DUE, reason: "y".repeat(250) }));
    const d1c = await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: d1.id } });
    check(
      "B-15",
      r15.error === undefined,
      r15.error ? `250-char reason threw ${errText(r15.error)}; dates ${d1c.invoiceDate.getTime() === d1b.invoiceDate.getTime() ? "unchanged" : "MOVED"}` : `result ${JSON.stringify(r15.value)}`,
    );
    await prisma.receivable.update({ where: { id: ar1b.id }, data: { paidAmount: 1000, outstandingAmount: { decrement: 1000 } } });
    const r14c = await updateDeliveryDatesAction({ deliveryId: d1.id, invoiceDate: INV, dueDate: DUE, reason: "after payment" });
    await prisma.receivable.update({ where: { id: ar1b.id }, data: { paidAmount: 0, outstandingAmount: { increment: 1000 } } });
    check(
      "B-14",
      !r14a.ok && r14a.reason === "INVALID_REQUEST" && !r14b.ok && r14b.reason === "INVALID_DATES" && !r14c.ok && r14c.reason === "RECEIVABLE_HAS_PAYMENTS",
      `blank ${r14a.ok ? "ok" : r14a.reason}, inverted ${r14b.ok ? "ok" : r14b.reason}, paid ${r14c.ok ? "ok" : r14c.reason}`,
    );

    // B-09 short stock at delivery
    const S = ids.item_SHORT;
    const os = await order(P, [{ itemId: S, qty: 3 }]);
    await approveFieldSalesOrderAction(os.orderId);
    await prisma.inventoryValue.updateMany({ where: { itemId: S }, data: { qtyOnHand: 1 } });
    const [ls] = await linesOf(os.orderId);
    const r9 = await recordDeliveryAction({ orderId: os.orderId, lines: [{ orderLineId: ls.id, qty: 3 }], invoiceDate: INV, dueDate: DUE, idempotencyKey: randomUUID() });
    const d9 = await prisma.fieldSalesDelivery.count({ where: { orderId: os.orderId } });
    check("B-09", !r9.ok && r9.reason === "INSUFFICIENT_STOCK" && r9.shortLines?.[0]?.orderLineId === ls.id && d9 === 0, `${r9.ok ? "ok" : r9.reason} ${JSON.stringify(r9.ok ? null : r9.shortLines)}; deliveries ${d9}`);
    await prisma.inventoryValue.updateMany({ where: { itemId: S }, data: { qtyOnHand: 3 } });
    ids.order_B09 = os.orderId;

    // B-11 close remainder refusals
    const r11a = await closeRemainderAction(o.orderId, "   ");
    const r11b = await closeRemainderAction(pending.orderId, "reason");
    check("B-11 blank/not approved", !r11a.ok && r11a.reason === "INVALID_REQUEST" && !r11b.ok && r11b.reason === "INVALID_STATE", `blank → ${r11a.ok ? "ok" : r11a.reason}, rejected order → ${r11b.ok ? "ok" : r11b.reason}`);

    // B-02 second delivery of line A remainder only, then B-10 close line B remainder
    const r2 = await recordDeliveryAction({ orderId: o.orderId, lines: [{ orderLineId: la.id, qty: 3 }, { orderLineId: lb.id, qty: 1 }], invoiceDate: INV, dueDate: DUE, idempotencyKey: randomUUID() });
    const deliveries2 = await prisma.fieldSalesDelivery.findMany({ where: { orderId: o.orderId }, orderBy: { createdAt: "asc" } });
    check("B-02 second partial", r2.ok && deliveries2.length === 2 && deliveries2[0].docNo !== deliveries2[1].docNo, `docs ${deliveries2.map((x) => x.docNo).join(", ")}`);
    const bBefore = await onHand(B);
    const r10 = await closeRemainderAction(o.orderId, "OPE store no longer wants it");
    const oRow10 = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: o.orderId } });
    const lb10 = await prisma.fieldSalesOrderLine.findUniqueOrThrow({ where: { id: lb.id } });
    const bAfter = await onHand(B);
    check(
      "B-10",
      r10.ok && lb10.cancelledQty === 3 && oRow10.closeReason === "OPE store no longer wants it" && bAfter.reserved === bBefore.reserved - 3 && bAfter.onHand === bBefore.onHand,
      `cancelled 3 on line B, reserved ${bBefore.reserved}→${bAfter.reserved}, deliveryStatus ${oRow10.deliveryStatus}`,
    );
    const sum = deliveries2.reduce((s, x) => s + Number(x.total), 0);
    check("B-02 totals", sum === 5 * 100000 + 1 * 50000, `delivery totals ${sum} = delivered value`);

    // B-13 deliver after close; B-11 nothing outstanding
    const r13 = await recordDeliveryAction({ orderId: o.orderId, lines: [{ orderLineId: lb.id, qty: 1 }], invoiceDate: INV, dueDate: DUE, idempotencyKey: randomUUID() });
    const r11c = await closeRemainderAction(o.orderId, "again");
    check("B-13", !r13.ok && r13.reason === "OVER_DELIVER", `${r13.ok ? "ok" : r13.reason}`);
    check("B-11 nothing outstanding", !r11c.ok && r11c.reason === "INVALID_STATE", `${r11c.ok ? "ok" : r11c.reason}`);

    // B-12 shipment in flight
    const of = await order(P, [{ itemId: B, qty: 4 }]);
    await approveFieldSalesOrderAction(of.orderId);
    const [lf] = await linesOf(of.orderId);
    await createDeliveryShipment({ orderId: of.orderId, method: "EXPEDITION", lines: [{ orderLineId: lf.id, qty: 2 }], packedById: adminId });
    const r12 = await closeRemainderAction(of.orderId, "close while packed");
    const lf12 = await prisma.fieldSalesOrderLine.findUniqueOrThrow({ where: { id: lf.id } });
    check("B-12", !r12.ok && r12.reason === "SHIPMENT_IN_FLIGHT" && lf12.cancelledQty === 0, `${r12.ok ? "ok" : r12.reason}, cancelled ${lf12.cancelledQty}`);
    ids.order_B12 = of.orderId;
  });

  it("C — faktur notification on print", async () => {
    const deliveryId = ids.delivery1;
    const notif = () =>
      prisma.adminNotification.findMany({ where: { category: "TAX_INVOICE_PENDING", createdAt: { gte: new Date(Date.now() - 10 * 60_000) } } });
    const unprintedBefore = await prisma.taxInvoice.count({ where: { notaPrintedAt: null } });

    asAdmin(["field_sales_orders:approve"]);
    await recordNotaTagihanPrinted(deliveryId);
    const t4 = await prisma.taxInvoice.findFirstOrThrow({ where: { deliveryId } });
    check("C-04", t4.notaPrintedAt === null, "no view permission → nothing stamped");
    asAdmin();

    await recordNotaTagihanPrinted("");
    const unprintedAfterEmpty = await prisma.taxInvoice.count({ where: { notaPrintedAt: null } });
    check("C-03", unprintedAfterEmpty === unprintedBefore, `unprinted fakturs ${unprintedBefore} → ${unprintedAfterEmpty}`);

    const before = (await notif()).filter((n) => (n.metadata as { deliveryId?: string } | null)?.deliveryId === deliveryId).length;
    await recordNotaTagihanPrinted(deliveryId);
    const t1 = await prisma.taxInvoice.findFirstOrThrow({ where: { deliveryId } });
    const after1 = (await notif()).filter((n) => (n.metadata as { deliveryId?: string } | null)?.deliveryId === deliveryId);
    await recordNotaTagihanPrinted(deliveryId);
    const t2 = await prisma.taxInvoice.findFirstOrThrow({ where: { deliveryId } });
    const after2 = (await notif()).filter((n) => (n.metadata as { deliveryId?: string } | null)?.deliveryId === deliveryId);
    const prints = await prisma.auditLog.count({ where: { entityId: deliveryId, action: "PRINT", entityType: "FieldSalesDeliveryNotaTagihan" } });
    check(
      "C-01",
      t1.notaPrintedAt !== null && before === 0 && after1.length === 1 && after1[0].message.includes(ids.store_P ? "OPE P" : ""),
      `stamped ${t1.notaPrintedAt?.toISOString()}, notification "${after1[0]?.message}"`,
    );
    check(
      "C-02",
      after2.length === 1 && t2.notaPrintedAt?.getTime() === t1.notaPrintedAt?.getTime() && prints >= 2,
      `reprint: notifications ${after2.length}, stamp unchanged, print audit rows ${prints}`,
    );
  });

  it("D — konsi approve", async () => {
    const K = ids.store_K;
    const K1 = ids.item_K1;
    const K2 = ids.item_K2;

    // Make KSENT "already sent": a prior approved konsi order at this store.
    const prior = await order(K, [{ itemId: ids.item_KSENT, qty: 1 }]);
    await approveFieldSalesOrderAction(prior.orderId);

    const ok = await order(K, [{ itemId: K1, qty: 5 }]);
    ids.order_D = ok.orderId;
    const k1Before = await onHand(K1);

    const tries: Array<[string, { itemId: string; variantSku: string; qty: number }[], string]> = [
      ["duplicate", [{ itemId: K1, variantSku: "", qty: 1 }], "DUPLICATE"],
      ["qty 0", [{ itemId: K2, variantSku: "", qty: 0 }], "(action) INVALID_ADDED_LINE"],
      ["unknown item", [{ itemId: "nope-" + run, variantSku: "", qty: 1 }], "UNKNOWN_ITEM"],
      ["no inventory row", [{ itemId: ids.item_KNOINV, variantSku: "", qty: 1 }], "NO_INVENTORY"],
      ["already sent", [{ itemId: ids.item_KSENT, variantSku: "", qty: 1 }], "ALREADY_SENT"],
    ];
    const outcomes: string[] = [];
    let allRefused = true;
    for (const [label, added, expected] of tries) {
      const r = await approveFieldSalesOrderAction(ok.orderId, undefined, added);
      const got = r.ok ? "ok" : r.addedLineCode ?? r.reason;
      outcomes.push(`${label} → ${got}`);
      const want = expected.startsWith("(action)") ? "INVALID_ADDED_LINE" : expected;
      if (r.ok || got !== want) allRefused = false;
    }
    const stillPending = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: ok.orderId } });
    const lineCount = await prisma.fieldSalesOrderLine.count({ where: { orderId: ok.orderId } });
    check("D-02", allRefused && stillPending.status === "PENDING_APPROVAL" && lineCount === 1, outcomes.join("; "));

    const recvBefore = await prisma.receivable.count({ where: { storeId: K } });
    const r3 = await approveFieldSalesOrderAction(ok.orderId, undefined, [{ itemId: ids.item_KNEW, variantSku: "", qty: 2 }]);
    const lines = await linesOf(ok.orderId);
    const added = lines.find((l) => l.itemId === ids.item_KNEW);
    const k1After = await onHand(K1);
    const knew = await onHand(ids.item_KNEW);
    check("D-03", r3.ok && added?.addedById === adminId && knew.reserved === 2, `added line by admin, KNEW reserved ${knew.reserved}`);
    const recvAfter = await prisma.receivable.count({ where: { storeId: K } });
    const deliveries = await prisma.fieldSalesDelivery.count({ where: { orderId: ok.orderId } });
    const storeStock = await prisma.storeStock.count({ where: { storeId: K } });
    const history = await prisma.salesHistory.count({ where: { itemId: K1, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } } });
    check(
      "D-01",
      k1After.onHand === k1Before.onHand && k1After.reserved === k1Before.reserved + 5 && recvAfter === recvBefore && deliveries === 0 && storeStock === 0 && history === 0,
      `on-hand ${k1Before.onHand}→${k1After.onHand}, reserved ${k1Before.reserved}→${k1After.reserved}, receivables +${recvAfter - recvBefore}, deliveries ${deliveries}, StoreStock ${storeStock}`,
    );

    const r5 = await approveFieldSalesOrderAction(ok.orderId, undefined, [{ itemId: K2, variantSku: "", qty: 1 }]);
    check("D-05", !r5.ok && r5.reason === "INVALID_TRANSITION", `${r5.ok ? "ok" : r5.reason}`);

    const r8 = await recordDeliveryAction({ orderId: ok.orderId, lines: [{ orderLineId: lines[0].id, qty: 1 }], invoiceDate: INV, dueDate: DUE, idempotencyKey: randomUUID() });
    check("B-08 konsi", !r8.ok && r8.reason === "INVALID_STATE", `${r8.ok ? "ok" : r8.reason}`);

    const short = await order(K, [{ itemId: K2, qty: 999 }]);
    const k2Before = await onHand(K2);
    const r4 = await approveFieldSalesOrderAction(short.orderId);
    const k2After = await onHand(K2);
    const shortRow = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: short.orderId } });
    check(
      "D-04",
      !r4.ok && r4.reason === "INSUFFICIENT_STOCK" && (r4.shortLines?.length ?? 0) === 1 && k2After.reserved === k2Before.reserved && shortRow.status === "PENDING_APPROVAL",
      `${r4.ok ? "ok" : r4.reason} ${JSON.stringify(r4.ok ? null : r4.shortLines)}; reserved unchanged; ${shortRow.status}`,
    );
    ids.order_D04 = short.orderId;
  });

  afterAll(() => {
    if (!enabled) return;
    console.log("OPE_REPORT " + JSON.stringify({ run, ids, report }, null, 2));
  });

  it("no FAIL rows", () => {
    expect(report.filter((r) => r.result === "FAIL")).toEqual([]);
  });
});
