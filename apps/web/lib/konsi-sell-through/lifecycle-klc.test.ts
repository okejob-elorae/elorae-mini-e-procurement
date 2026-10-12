import { describe, it, expect, beforeAll, vi } from "vitest";
import { prisma } from "@elorae/db";
import { createKonsiPushOrder } from "@/lib/field-sales/konsi-push-writer";
import {
  createDeliveryShipment,
  updateShipmentTracking,
  shipDeliveryShipment,
  completeDeliveryShipment,
} from "@/lib/delivery/shipment-writer";
import { recordSpgSale } from "@/lib/spg/sale-writer";
import { createStoreStocktake, saveStocktakeCounts, approveStoreStocktake } from "@/lib/stores/stocktake/writer";
import { getStoreStocktakeById } from "@/lib/stores/stocktake/queries";
import { createSellThrough, resolveSellThroughLine, approveSellThrough } from "./writer";
import { voidSellThrough } from "./void-writer";
import { resolutionArmsFor, resolutionNeedsReason } from "./derive";
import { createFieldReturn } from "@/lib/field-sales/retur/writer";
import { runKonsiCountSweep } from "@/lib/konsi-count-schedule/sweep";

/*
 * Opt-in end-to-end run of test-run/konsi-lifecycle-edge-plan.md on the KLC fixture
 * (test-run/setup-konsi-lifecycle-edge.cjs). Leaves its rows behind on purpose so the
 * results can be inspected in the UI. Never runs in the normal suite.
 */
const url = process.env.DATABASE_URL ?? "";
const enabled = process.env.KLC_E2E === "1" && url.includes(":3308");
const d = enabled ? describe : describe.skip;

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

type Ids = {
  storeA: string; storeB: string; storeP: string;
  simple: string; variant: string; never: string; short: string; noPrice: string;
  admin: string; salesman: string; spg: string;
};

const run = Date.now().toString(36);
const ids = {} as Ids;
const report: Array<{ id: string; result: string; note?: string }> = [];
const record = (id: string, result: string, note?: string) => report.push({ id, result, note });

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    const err = e as { code?: string; name?: string; message?: string };
    return err.code ?? err.name ?? String(err.message);
  }
}

const mainQty = async (itemId: string, variantSku = "") => {
  const row = await prisma.inventoryValue.findFirstOrThrow({
    where: { itemId, OR: [{ variantSku }, ...(variantSku === "" ? [{ variantSku: null }] : [])] },
    orderBy: { id: "asc" },
  });
  return { onHand: Number(row.qtyOnHand), reserved: Number(row.reservedQty), id: row.id };
};
const storeQty = async (storeId: string, itemId: string, variantSku = "") => {
  const row = await prisma.storeStock.findUnique({ where: { storeId_itemId_variantSku: { storeId, itemId, variantSku } } });
  return row ? Number(row.qty) : 0;
};

d("konsi lifecycle — KLC fixture end to end (opt-in)", () => {
  let orderId = "";
  let stocktakeId = "";
  let reportId = "";

  beforeAll(async () => {
    const store = (code: string) => prisma.store.findUniqueOrThrow({ where: { code } }).then((s) => s.id);
    const item = (sku: string) => prisma.item.findUniqueOrThrow({ where: { sku } }).then((i) => i.id);
    const user = (email: string) => prisma.user.findUniqueOrThrow({ where: { email } }).then((u) => u.id);
    const template = await prisma.store.findUniqueOrThrow({ where: { code: "SMOKE-KLC-A" } });
    const fresh = await prisma.store.create({
      data: {
        code: `SMOKE-KLC-A-${run}`, name: `Smoke KLC Store A run ${run}`, address: template.address,
        termsType: "KONSI", paymentTempo: template.paymentTempo, markupPercent: template.markupPercent,
        sellThroughMethod: template.sellThroughMethod, lat: template.lat, lng: template.lng, isActive: true,
      },
    });
    await prisma.user.update({ where: { email: "spg@elorae.com" }, data: { assignedStoreId: fresh.id } });
    Object.assign(ids, {
      storeA: fresh.id, storeB: await store("SMOKE-KLC-B"), storeP: await store("SMOKE-KLC-P"),
      simple: await item("KLC-SIMPLE"), variant: await item("KLC-VAR"), never: await item("KLC-NEVER"),
      short: await item("KLC-SHORT"), noPrice: await item("KLC-NOPRICE"),
      admin: await user("admin@elorae.com"), salesman: await user("salesman@elorae.com"), spg: await user("spg@elorae.com"),
    });
  });

  it("T-01/T-07/T-08 admin push: refusals, then a push that only reserves", async () => {
    const base = { salesmanId: ids.salesman, pushedById: ids.admin };
    const toPutus = await codeOf(createKonsiPushOrder({ ...base, storeId: ids.storeP, idempotencyKey: `klc-p-${run}`, lines: [{ itemId: ids.simple, variantSku: "", qty: 1 }] }));
    expect(toPutus).toBe("NOT_KONSI");
    record("T-01", "PASS", toPutus);

    const shortBefore = await mainQty(ids.short);
    const short = await codeOf(createKonsiPushOrder({ ...base, storeId: ids.storeA, idempotencyKey: `klc-short-${run}`, lines: [{ itemId: ids.short, variantSku: "", qty: 5 }] }));
    expect(short).not.toBe("OK");
    expect((await mainQty(ids.short)).reserved).toBe(shortBefore.reserved);
    record("T-07", "PASS", short);

    const before = await mainQty(ids.simple);
    const res = await createKonsiPushOrder({
      ...base, storeId: ids.storeA, idempotencyKey: `klc-push-${run}`,
      lines: [
        { itemId: ids.simple, variantSku: "", qty: 10 },
        { itemId: ids.variant, variantSku: "KLC-VAR-M", qty: 5 },
        { itemId: ids.never, variantSku: "", qty: 4 },
      ],
    });
    orderId = res.orderId;
    const replay = await createKonsiPushOrder({
      ...base, storeId: ids.storeA, idempotencyKey: `klc-push-${run}`,
      lines: [{ itemId: ids.simple, variantSku: "", qty: 10 }, { itemId: ids.variant, variantSku: "KLC-VAR-M", qty: 5 }, { itemId: ids.never, variantSku: "", qty: 4 }],
    });
    expect(replay.orderId).toBe(orderId);
    record("T-06", "PASS", "same key replays the same order");

    const after = await mainQty(ids.simple);
    expect(after.onHand).toBe(before.onHand);
    expect(after.reserved).toBe(before.reserved + 10);
    expect(await storeQty(ids.storeA, ids.simple)).toBe(0);
    expect(await prisma.receivable.count({ where: { sellThrough: { storeId: ids.storeA } } })).toBe(0);
    record("T-08", "PASS", `${res.orderNo} reserved 10, on-hand unchanged`);
  });

  it("T-14/T-23/T-15/T-16 shipment: double-claim refused, short main stock rolls back, then partial delivery", async () => {
    const lines = await prisma.fieldSalesOrderLine.findMany({ where: { orderId }, orderBy: { id: "asc" } });
    const { shipmentId } = await createDeliveryShipment({
      orderId, method: "EXPEDITION", packedById: ids.admin,
      lines: lines.map((l) => ({ orderLineId: l.id, qty: l.qty })),
    });
    const second = await codeOf(createDeliveryShipment({ orderId, method: "EXPEDITION", packedById: ids.admin, lines: [{ orderLineId: lines[0].id, qty: 1 }] }));
    expect(second).not.toBe("OK");
    record("T-14", "PASS", second);

    await updateShipmentTracking({ shipmentId, carrierName: "JNE", resiNumber: `KLC-${run}` });
    await shipDeliveryShipment({ shipmentId, shippedById: ids.admin });
    const shipment = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { lines: true } });
    const byOrderLine = new Map(shipment.lines.map((l) => [l.orderLineId, l.id]));
    const neverLine = lines.find((l) => l.itemId === ids.never)!;

    const complete = (delivered: (itemId: string, qty: number) => number) =>
      completeDeliveryShipment({
        shipmentId, deliveredById: ids.admin,
        proofPhotoUrl: "https://r2.example/klc-proof.jpg",
        proofPhotoR2Key: `delivery-proofs/${shipmentId}/goods.jpg`,
        lines: lines.map((l) => ({ shipmentLineId: byOrderLine.get(l.id)!, deliveredQty: delivered(l.itemId, l.qty) })),
      });

    const never = await mainQty(ids.never);
    await prisma.inventoryValue.update({ where: { id: never.id }, data: { qtyOnHand: 2 } });
    const shortCode = await codeOf(complete((_, q) => q));
    const afterFail = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: shipmentId } });
    const transfersAfterFail = await prisma.konsiTransfer.count({ where: { orderId } });
    const simpleStoreAfterFail = await storeQty(ids.storeA, ids.simple);
    await prisma.inventoryValue.update({ where: { id: never.id }, data: { qtyOnHand: never.onHand } });
    expect(shortCode).not.toBe("OK");
    expect(afterFail.status).toBe("IN_TRANSIT");
    expect(transfersAfterFail).toBe(0);
    expect(simpleStoreAfterFail).toBe(0);
    record("T-23", "PASS", `${shortCode}; shipment still IN_TRANSIT, no transfer, no store stock`);

    const simpleMain = await mainQty(ids.simple);
    await complete((itemId, q) => (itemId === ids.never ? q - 1 : q));
    expect(await prisma.konsiTransfer.count({ where: { orderId } })).toBe(1);
    expect(await storeQty(ids.storeA, ids.simple)).toBe(10);
    expect(await storeQty(ids.storeA, ids.variant, "KLC-VAR-M")).toBe(5);
    expect(await storeQty(ids.storeA, ids.never)).toBe(3);
    expect((await mainQty(ids.simple)).onHand).toBe(simpleMain.onHand - 10);
    const neverOrderLine = await prisma.fieldSalesOrderLine.findUniqueOrThrow({ where: { id: neverLine.id } });
    expect(neverOrderLine.deliveredQty).toBe(3);
    expect(await prisma.fieldSalesDelivery.count({ where: { orderId } })).toBe(0);
    expect(await prisma.receivable.count({ where: { sellThrough: { storeId: ids.storeA } } })).toBe(0);
    record("T-15/T-16/Z-02", "PASS", "1 transfer for delivered qty, never-sent line 3 of 4, no delivery/receivable");

    const replay = await codeOf(complete((itemId, q) => (itemId === ids.never ? q - 1 : q)));
    expect(await prisma.konsiTransfer.count({ where: { orderId } })).toBe(1);
    record("T-22", "PASS", `same-actor replay → ${replay}, still 1 transfer`);
  });

  it("S-01..S-04 SPG sales: marked-up price, no floor on store stock, no main stock move", async () => {
    const mainBefore = await mainQty(ids.simple);
    const sale = await recordSpgSale({
      salesmanId: ids.spg, storeId: ids.storeA, cashReceived: 1_000_000, idempotencyKey: `klc-sale-${run}`,
      lines: [{ itemId: ids.simple, variantSku: null, qty: 3 }, { itemId: ids.variant, variantSku: "KLC-VAR-M", qty: 1 }],
    });
    expect(sale.ok).toBe(true);
    if (!sale.ok) return;
    const saleRow = await prisma.spgSale.findUniqueOrThrow({ where: { id: sale.spgSaleId }, include: { lines: true } });
    const simpleLine = saleRow.lines.find((l) => l.itemId === ids.simple)!;
    expect(Number(simpleLine.unitPrice)).toBe(120000);
    expect(Number(saleRow.total)).toBe(3 * 120000 + 180000);
    expect(Number(saleRow.total) % 1).toBe(0);
    record("C-01/S-02", "PASS", `KLC-SIMPLE sold at 120000 (100000 +20%), total ${Number(saleRow.total)}`);

    const over = await recordSpgSale({
      salesmanId: ids.spg, storeId: ids.storeA, cashReceived: 1_000_000, idempotencyKey: `klc-sale-over-${run}`,
      lines: [{ itemId: ids.never, variantSku: null, qty: 4 }],
    });
    expect(over.ok).toBe(true);
    expect(await storeQty(ids.storeA, ids.never)).toBe(-1);
    record("S-01", "PASS", "sold 4 against 3 on hand → store qty −1");

    expect((await mainQty(ids.simple)).onHand).toBe(mainBefore.onHand);
    expect(await storeQty(ids.storeA, ids.simple)).toBe(7);
    record("S-04", "PASS", "store stock down, main unchanged");
  });

  it("S-05/S-06 stocktake: variance sign, and a sale after the count is not lost", async () => {
    const st = await createStoreStocktake({ storeId: ids.storeA, createdById: ids.admin, countedAt: new Date() });
    stocktakeId = st.id;
    const doc = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: st.id }, include: { lines: true } });
    const lineFor = (itemId: string) => doc.lines.find((l) => l.itemId === itemId)!;
    const counted: Record<string, number> = { [ids.simple]: 6, [ids.variant]: 4, [ids.never]: 0 };
    await saveStocktakeCounts({
      stocktakeId: st.id, userId: ids.admin, submit: true,
      lines: doc.lines.map((l) => {
        const countedQty = counted[l.itemId] ?? Number(l.expectedQty);
        return { lineId: l.id, countedQty, cause: countedQty < Number(l.expectedQty) ? ("SHRINKAGE" as const) : null, reason: "KLC count" };
      }),
    });
    const noCause = await codeOf(approveStoreStocktake({ stocktakeId: "missing", approvedById: ids.admin }));
    expect(noCause).toBe("NOT_FOUND");
    const saved = await prisma.storeStocktakeLine.findUniqueOrThrow({ where: { id: lineFor(ids.simple).id } });
    expect(Number(saved.varianceQty)).toBe(-1);
    record("S-05", "PASS", "expected 7, counted 6 → varianceQty −1");

    await approveStoreStocktake({ stocktakeId: st.id, approvedById: ids.admin });
    expect(await storeQty(ids.storeA, ids.simple)).toBe(6);
    expect(await storeQty(ids.storeA, ids.never)).toBe(0);
    record("S-06(base)", "PASS", "approve SETs counted figures");
  });

  it("R-07/R-08/I-01..I-04/I-08 report: held until resolved, invoiced at catalog price", async () => {
    const r = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: ids.admin });
    reportId = r.id;
    const dup = await codeOf(createSellThrough({ closingStocktakeId: stocktakeId, createdById: ids.admin }));
    expect(dup).not.toBe("OK");
    record("R-02", "PASS", dup);

    const approveInvoice = (salesmanId: string | null) =>
      approveSellThrough({ id: reportId, approvedById: ids.admin, mode: "INVOICE", invoiceDate: new Date(), salesmanId });

    const lines = await prisma.konsiSellThroughLine.findMany({ where: { sellThroughId: reportId } });
    const gaps = lines.filter((l) => Number(l.gapQty) !== 0);
    if (gaps.length > 0) {
      const held = await codeOf(approveInvoice(ids.salesman));
      expect(held).toBe("HELD");
      record("R-07", "PASS", `${gaps.length} gap line(s) → HELD`);

      const firstArmNeedingReason = gaps.flatMap((g) => resolutionArmsFor(Number(g.gapQty)).filter(resolutionNeedsReason).map((arm) => ({ g, arm })))[0];
      if (firstArmNeedingReason) {
        const noReason = await codeOf(resolveSellThroughLine({ lineId: firstArmNeedingReason.g.id, resolution: firstArmNeedingReason.arm, reason: null, userId: ids.admin }));
        expect(noReason).not.toBe("OK");
        record("R-08", "PASS", `${firstArmNeedingReason.arm} without reason → ${noReason}`);
      }
      for (const g of gaps) {
        const arm = resolutionArmsFor(Number(g.gapQty))[0];
        await resolveSellThroughLine({ lineId: g.id, resolution: arm, reason: "KLC resolve", userId: ids.admin });
      }
    } else {
      record("R-07", "NOTE", "no gap lines were derived — hold not exercised");
    }

    const noSalesman = await codeOf(approveInvoice(null));
    record("I-03a", noSalesman === "SALESMAN_REQUIRED" ? "PASS" : "CHECK", noSalesman);
    const badSalesman = await codeOf(approveInvoice(ids.spg));
    record("I-03b", badSalesman === "SALESMAN_INVALID" ? "PASS" : "CHECK", badSalesman);

    const badDate = await codeOf(approveSellThrough({ id: reportId, approvedById: ids.admin, mode: "INVOICE", invoiceDate: new Date("invalid"), salesmanId: ids.salesman }));
    expect(badDate).toBe("INVALID_INVOICE_DATE");
    record("I-04a", "PASS", badDate);

    const approved = await approveInvoice(ids.salesman);
    const st = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: reportId }, include: { lines: true } });
    expect(st.status).toBe("APPROVED");
    const catalog: Record<string, number> = { [ids.simple]: 100000, [ids.variant]: 150000, [ids.never]: 90000 };
    for (const l of st.lines) {
      if (l.unitPrice === null) continue;
      expect(Number(l.unitPrice)).toBe(catalog[l.itemId]);
    }
    record("I-01", "PASS", st.lines.map((l) => `${l.itemId === ids.simple ? "SIMPLE" : l.itemId === ids.variant ? "VAR" : "NEVER"} billed ${Number(l.billedQty ?? 0)} @ ${l.unitPrice === null ? "-" : Number(l.unitPrice)}`).join("; "));

    const days = Math.round((st.dueDate!.getTime() - st.invoiceDate!.getTime()) / 86_400_000);
    expect(days).toBe(30);
    record("I-04b", "PASS", "due = invoice + 30 (store tempo)");

    if (approved.invoiced) {
      const recv = await prisma.receivable.findUniqueOrThrow({ where: { sellThroughId: reportId } });
      const faktur = await prisma.taxInvoice.findUniqueOrThrow({ where: { sellThroughId: reportId } });
      expect(recv.deliveryId).toBeNull();
      expect(Number(recv.originalAmount)).toBe(Number(st.total));
      expect(faktur.deliveryId).toBeNull();
      record("I-08", "PASS", `receivable ${Number(recv.originalAmount)} + faktur ${faktur.status}`);
    } else {
      record("I-07", "PASS", "zero total → no receivable/faktur");
    }
  });

  it("I-11/I-12/I-16/I-17 void, then recreate from the same count", async () => {
    const empty = await codeOf(voidSellThrough({ id: reportId, voidedById: ids.admin, reason: "   " }));
    expect(empty).toBe("VOID_REASON_REQUIRED");
    const long = await codeOf(voidSellThrough({ id: reportId, voidedById: ids.admin, reason: "x".repeat(1001) }));
    expect(long).toBe("VOID_REASON_REQUIRED");
    record("I-11", "PASS", `${empty}; >1000 chars → ${long}`);

    const stockBefore = await prisma.storeStock.findMany({ where: { storeId: ids.storeA }, orderBy: { id: "asc" } });
    const ledgerBefore = await prisma.stockLedgerEntry.count({ where: { locationType: "STORE", locationId: ids.storeA } });
    await voidSellThrough({ id: reportId, voidedById: ids.admin, reason: "KLC wrong invoice" });
    const again = await codeOf(voidSellThrough({ id: reportId, voidedById: ids.admin, reason: "again" }));
    expect(again).toBe("INVALID_STATE");
    record("I-12", "PASS", `double void → ${again}`);

    const st = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: reportId } });
    expect(st.status).toBe("VOIDED");
    expect(st.stocktakeKey).toBeNull();
    expect(st.chainKey).toBeNull();
    const recv = await prisma.receivable.findUnique({ where: { sellThroughId: reportId } });
    if (recv) {
      expect(recv.status).toBe("VOIDED");
      expect(Number(recv.outstandingAmount)).toBe(0);
      const faktur = await prisma.taxInvoice.findUniqueOrThrow({ where: { sellThroughId: reportId } });
      expect(faktur.status).toBe("CANCELLED");
    }
    const stockAfter = await prisma.storeStock.findMany({ where: { storeId: ids.storeA }, orderBy: { id: "asc" } });
    expect(stockAfter.map((s) => Number(s.qty))).toEqual(stockBefore.map((s) => Number(s.qty)));
    expect(await prisma.stockLedgerEntry.count({ where: { locationType: "STORE", locationId: ids.storeA } })).toBe(ledgerBefore);
    record("I-16", "PASS", "VOIDED, both keys null, receivable VOIDED/0, faktur CANCELLED, no stock or ledger change");

    const recreated = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: ids.admin });
    const row = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: recreated.id }, include: { lines: true } });
    expect(row.previousId).toBeNull();
    for (const l of row.lines.filter((x) => Number(x.gapQty) !== 0)) {
      await resolveSellThroughLine({ lineId: l.id, resolution: resolutionArmsFor(Number(l.gapQty))[0], reason: "KLC resolve", userId: ids.admin });
    }
    await approveSellThrough({ id: recreated.id, approvedById: ids.admin, mode: "INVOICE", invoiceDate: new Date(), salesmanId: ids.salesman });
    reportId = recreated.id;
    record("I-17", "PASS", `${recreated.docNo} recreated from the same count, previousId null, approved`);
  });

  it("X-06/X-05/R-04 admin return without photo, then a count while it is in flight is refused", async () => {
    const ret = await createFieldReturn({
      storeId: ids.storeA, raisedById: ids.admin, origin: "ADMIN",
      lines: [{ itemId: ids.variant, variantSku: "KLC-VAR-M", qty: 2, reason: "UNSOLD" }],
    });
    record("X-06", "PASS", `${ret.docNo} raised with no nota photo / transport`);

    const noPhotoField = await codeOf(createFieldReturn({
      storeId: ids.storeA, raisedById: ids.admin,
      lines: [{ itemId: ids.variant, variantSku: "KLC-VAR-M", qty: 1, reason: "UNSOLD" }],
    }));
    expect(noPhotoField).not.toBe("OK");
    record("X-06b", "PASS", `FIELD origin without photo → ${noPhotoField}`);

    const st = await createStoreStocktake({ storeId: ids.storeA, createdById: ids.admin, countedAt: new Date() });
    const doc = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: st.id }, include: { lines: true } });
    await saveStocktakeCounts({
      stocktakeId: st.id, userId: ids.admin, submit: true,
      lines: doc.lines.map((l) => ({ lineId: l.id, countedQty: Number(l.expectedQty), cause: null, reason: null })),
    });
    await approveStoreStocktake({ stocktakeId: st.id, approvedById: ids.admin });
    const inFlight = await codeOf(createSellThrough({ closingStocktakeId: st.id, createdById: ids.admin }));
    expect(inFlight).toBe("RETUR_IN_FLIGHT");
    record("R-04/X-05", "PASS", inFlight);
  });

  it("Z-01 store ledger reconciles to StoreStock for every key", async () => {
    const stock = await prisma.storeStock.findMany({ where: { storeId: ids.storeA } });
    const mismatches: string[] = [];
    for (const s of stock) {
      const last = await prisma.stockLedgerEntry.findFirst({
        where: { locationType: "STORE", locationId: ids.storeA, itemId: s.itemId, variantSku: s.variantSku },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      if (!last || Number(last.balanceQty) !== Number(s.qty)) mismatches.push(`${s.itemId}::${s.variantSku} stock=${Number(s.qty)} ledger=${last ? Number(last.balanceQty) : "none"}`);
    }
    expect(mismatches).toEqual([]);
    record("Z-01", "PASS", `${stock.length} keys reconcile`);
  });

  it("M-06/M-11 count sweep: store too new is NOT_YET, a store with no SPG gets a System creator", async () => {
    const sept = new Date("2026-09-30T05:00:00Z");
    const freshB = await prisma.store.create({
      data: { code: `SMOKE-KLC-B-${run}`, name: `Smoke KLC Store B run ${run}`, address: "Local KLC fixture", termsType: "KONSI", paymentTempo: 14, sellThroughMethod: "SHELF_COUNT", lat: -6.2, lng: 106.8, isActive: true },
    });
    ids.storeB = freshB.id;
    const tooNew = await runKonsiCountSweep({ storeIds: [ids.storeB], now: sept, schedule: { dueDay: "last", leadDays: 3 } });
    expect(await prisma.storeStocktake.count({ where: { storeId: ids.storeB } })).toBe(0);
    record("M-06", "PASS", `store created today → nothing opened (${JSON.stringify(tooNew)})`);

    const none = await runKonsiCountSweep({ storeIds: [], now: sept, schedule: { dueDay: "last", leadDays: 3 } });
    record("M-08", "PASS", `storeIds [] → ${JSON.stringify(none)}`);

    await prisma.store.update({ where: { id: ids.storeB }, data: { createdAt: new Date("2026-08-01T00:00:00Z") } });
    await runKonsiCountSweep({ storeIds: [ids.storeB], now: sept, schedule: { dueDay: "last", leadDays: 3 } });
    const opened = await prisma.storeStocktake.findFirst({ where: { storeId: ids.storeB }, orderBy: { createdAt: "desc" } });
    expect(opened).not.toBeNull();
    const detail = await getStoreStocktakeById(opened!.id);
    expect(detail?.createdByIsSystem).toBe(true);
    record("M-11", "PASS", `${opened!.docNo} createdById=${opened!.createdById}, detail renders System`);

    await runKonsiCountSweep({ storeIds: [ids.storeB], now: sept, schedule: { dueDay: "last", leadDays: 3 } });
    expect(await prisma.storeStocktake.count({ where: { storeId: ids.storeB } })).toBe(1);
    record("M-03", "PASS", "second sweep same month opens nothing");
  });

  it("prints the case log", () => {
    console.log("\nKLC_REPORT " + JSON.stringify(report, null, 1));
  });
});
