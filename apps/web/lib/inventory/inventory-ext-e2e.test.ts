import { describe, it, expect, beforeAll, vi } from "vitest";
import { prisma, moveStoreStock } from "@elorae/db";
import { createStoreTransfer, approveStoreTransfer, cancelStoreTransfer } from "@/lib/stores/transfer/writer";
import { createStoreStocktake, saveStocktakeCounts, approveStoreStocktake, cancelStoreStocktake } from "@/lib/stores/stocktake/writer";
import { createKonsiPushOrder } from "@/lib/field-sales/konsi-push-writer";
import { loadVan } from "@/lib/canvassing/writer";
import { recordVanSale } from "@/lib/canvassing/sale-writer";
import { recordVanReconcile } from "@/lib/canvassing/reconcile-writer";
import { getStockAcrossLocations } from "@/lib/inventory/stock-across-locations";
import { getItemMovementCard } from "@/lib/inventory/stock-ledger-card";
import { parseDateOnly, parseDateOnlyEnd, formatDateOnlyJakarta } from "@/lib/date-only";

/*
 * Opt-in end-to-end run of test-run/inventory-extensions-edge-plan.md. Needs the IXT fixture
 * (test-run/setup-inventory-ext-edge.cjs, rerun before each driver run). Creates fresh stores and a
 * canvasser per run and leaves every row behind so the results can be inspected in the UI.
 */
const url = process.env.DATABASE_URL ?? "";
const enabled = process.env.IXT_E2E === "1" && url.includes(":3308");
const d = enabled ? describe : describe.skip;

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

const run = Date.now().toString(36);
const HOUR = 3_600_000;
const ids = {
  k1: "", k2: "", p: "", off: "", canvasser: "",
  simple: "", variant: "", noPrice: "", admin: "", salesman: "",
};
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

const storeQty = async (storeId: string, itemId: string, variantSku = "") => {
  const row = await prisma.storeStock.findUnique({ where: { storeId_itemId_variantSku: { storeId, itemId, variantSku } } });
  return row ? Number(row.qty) : 0;
};
const storeAvg = async (storeId: string, itemId: string, variantSku = "") => {
  const row = await prisma.storeStock.findUnique({ where: { storeId_itemId_variantSku: { storeId, itemId, variantSku } } });
  return row ? Number(row.avgCost) : 0;
};
const vanQty = async (itemId: string, variantSku = "") => {
  const row = await prisma.vanStock.findUnique({ where: { userId_itemId_variantSku: { userId: ids.canvasser, itemId, variantSku } } });
  return row ? Number(row.qty) : 0;
};
const main = async (itemId: string, variantSku = "") => {
  const row = await prisma.inventoryValue.findFirstOrThrow({
    where: { itemId, OR: [{ variantSku }, ...(variantSku === "" ? [{ variantSku: null }] : [])] },
    orderBy: { id: "asc" },
  });
  return { onHand: Number(row.qtyOnHand), reserved: Number(row.reservedQty) };
};
const seedStore = (storeId: string, itemId: string, variantSku: string, qty: number, avgCost: number) =>
  prisma.$transaction((tx) =>
    moveStoreStock(tx, {
      storeId, itemId, variantSku, qtyDelta: qty, avgCost, unitCost: avgCost, totalCost: qty * avgCost,
      balanceValue: qty * avgCost, refType: "KonsiTransfer", refId: `ixt-seed-${run}`, refDocNumber: `IXT-SEED-${run}`,
      createdById: ids.admin,
    }),
  );

d("inventory extensions — end to end (opt-in)", () => {
  beforeAll(async () => {
    const item = (sku: string) => prisma.item.findUniqueOrThrow({ where: { sku } }).then((i) => i.id);
    const user = (email: string) => prisma.user.findUniqueOrThrow({ where: { email } }).then((u) => u.id);
    const store = (suffix: string, termsType: "KONSI" | "PUTUS", isActive = true) =>
      prisma.store
        .create({
          data: {
            code: `SMOKE-IXT-${suffix}-${run}`, name: `Smoke IXT ${suffix} run ${run}`, address: "Local IXT fixture",
            termsType, markupPercent: termsType === "KONSI" ? 20 : null, lat: -6.2, lng: 106.8, isActive,
          },
        })
        .then((s) => s.id);
    const canvasser = await prisma.user.create({ data: { email: `ixt-canvasser-${run}@example.com`, name: `IXT Canvasser ${run}` } });
    Object.assign(ids, {
      k1: await store("K1", "KONSI"), k2: await store("K2", "KONSI"), p: await store("P", "PUTUS"), off: await store("OFF", "KONSI", false),
      canvasser: canvasser.id,
      simple: await item("IXT-SIMPLE"), variant: await item("IXT-VAR"), noPrice: await item("IXT-NOPRICE"),
      admin: await user("admin@elorae.com"), salesman: await user("salesman@elorae.com"),
    });
    await seedStore(ids.k1, ids.simple, "", 10, 40000);
    await seedStore(ids.k1, ids.variant, "IXT-VAR-M", 6, 60000);
  });

  const base = () => ({ fromStoreId: ids.k1, toStoreId: ids.k2, movedAt: new Date(Date.now() - HOUR), createdById: ids.admin });

  it("T-01..T-08 create refusals", async () => {
    const one = [{ itemId: ids.simple, variantSku: "", qty: 1 }];
    const results: Record<string, string> = {
      "T-01": await codeOf(createStoreTransfer({ ...base(), toStoreId: ids.k1, lines: one })),
      "T-02": await codeOf(createStoreTransfer({ ...base(), lines: [] })),
      "T-03 zero": await codeOf(createStoreTransfer({ ...base(), lines: [{ ...one[0], qty: 0 }] })),
      "T-03 negative": await codeOf(createStoreTransfer({ ...base(), lines: [{ ...one[0], qty: -2 }] })),
      "T-03 NaN": await codeOf(createStoreTransfer({ ...base(), lines: [{ ...one[0], qty: Number.NaN }] })),
      "T-04": await codeOf(createStoreTransfer({ ...base(), movedAt: new Date(Date.now() + 24 * HOUR), lines: one })),
      "T-05": await codeOf(createStoreTransfer({ ...base(), toStoreId: "no-such-store", lines: one })),
      "T-06": await codeOf(createStoreTransfer({ ...base(), lines: [{ itemId: "no-such-item", variantSku: "", qty: 1 }] })),
    };
    expect(results).toEqual({
      "T-01": "SAME_STORE", "T-02": "NO_LINES", "T-03 zero": "BAD_QTY", "T-03 negative": "BAD_QTY", "T-03 NaN": "BAD_QTY",
      "T-04": "MOVED_AT_IN_FUTURE", "T-05": "STORE_NOT_FOUND", "T-06": "ITEM_NOT_FOUND",
    });
    for (const [id, code] of Object.entries(results)) record(id, "PASS", code);

    const bogus = await codeOf(createStoreTransfer({ ...base(), lines: [{ itemId: ids.variant, variantSku: "IXT-VAR-XXL", qty: 1 }] }));
    const blankOnVariant = await codeOf(createStoreTransfer({ ...base(), lines: [{ itemId: ids.variant, variantSku: "", qty: 1 }] }));
    const skuOnSimple = await codeOf(createStoreTransfer({ ...base(), lines: [{ itemId: ids.simple, variantSku: "IXT-VAR-M", qty: 1 }] }));
    expect([bogus, blankOnVariant, skuOnSimple]).toEqual(["BAD_VARIANT", "BAD_VARIANT", "BAD_VARIANT"]);
    record("T-07", "PASS", "bogus variant / blank key on a variant item / variant key on a simple item → BAD_VARIANT");

    const inactive = await codeOf(createStoreTransfer({ ...base(), toStoreId: ids.off, lines: one }));
    record("T-08", "NOTE", `inactive destination → ${inactive} (allowed; form lists inactive stores too)`);
  });

  it("T-09..T-14, T-19, T-20 approve moves both legs at the source's current cost", async () => {
    const { transferId } = await createStoreTransfer({ ...base(), lines: [{ itemId: ids.simple, variantSku: "", qty: 4 }] });
    const doc = await prisma.storeTransfer.findUniqueOrThrow({ where: { id: transferId }, include: { lines: true } });
    expect(doc.status).toBe("PENDING");
    expect(Number(doc.lines[0].unitCost)).toBe(40000);
    expect(await prisma.stockLedgerEntry.count({ where: { refId: transferId } })).toBe(0);
    expect(await storeQty(ids.k1, ids.simple)).toBe(10);
    record("T-09", "PASS", `${doc.docNo} pending, unitCost snapshot 40000, nothing moved`);

    await seedStore(ids.k1, ids.simple, "", 10, 50000);
    await approveStoreTransfer({ transferId, approvedById: ids.admin });
    const rows = await prisma.stockLedgerEntry.findMany({ where: { refId: transferId }, orderBy: { qty: "asc" } });
    expect(rows.map((r) => [r.locationId, Number(r.qty), Number(r.unitCost), Number(r.balanceQty)])).toEqual([
      [ids.k1, -4, 50000, 16],
      [ids.k2, 4, 50000, 4],
    ]);
    expect(await storeAvg(ids.k2, ids.simple)).toBe(50000);
    record("T-10", "PASS", "source repriced 40000→50000 after create; both legs costed 50000");

    expect(await codeOf(approveStoreTransfer({ transferId, approvedById: ids.admin }))).toBe("INVALID_STATE");
    expect(await codeOf(cancelStoreTransfer({ transferId, cancelledById: ids.admin }))).toBe("INVALID_STATE");
    expect(await prisma.stockLedgerEntry.count({ where: { refId: transferId } })).toBe(2);
    record("T-13", "PASS", "second approve INVALID_STATE, stock moved once");
    record("T-14", "PASS", "cancel after approve INVALID_STATE");

    const over = await createStoreTransfer({ ...base(), fromStoreId: ids.k2, toStoreId: ids.p, lines: [{ itemId: ids.simple, variantSku: "", qty: 10 }] });
    await approveStoreTransfer({ transferId: over.transferId, approvedById: ids.admin });
    expect(await storeQty(ids.k2, ids.simple)).toBe(-6);
    expect(await storeQty(ids.p, ids.simple)).toBe(10);
    record("T-12", "PASS", "K2 held 4, sent 10 → −6 (no floor)");
    record("T-19", "PASS", "KONSI → PUTUS approved");

    const intoNegative = await createStoreTransfer({ ...base(), lines: [{ itemId: ids.simple, variantSku: "", qty: 2 }] });
    await approveStoreTransfer({ transferId: intoNegative.transferId, approvedById: ids.admin });
    expect(await storeQty(ids.k2, ids.simple)).toBe(-4);
    expect(await storeAvg(ids.k2, ids.simple)).toBe(50000);
    record("T-11", "PASS", "dest −6 + 2 → −4; blend clamped (avg = incoming 50000)");

    const dup = await createStoreTransfer({
      ...base(),
      lines: [{ itemId: ids.variant, variantSku: "IXT-VAR-M", qty: 1 }, { itemId: ids.variant, variantSku: "IXT-VAR-M", qty: 2 }],
    });
    await approveStoreTransfer({ transferId: dup.transferId, approvedById: ids.admin });
    expect(await storeQty(ids.k1, ids.variant, "IXT-VAR-M")).toBe(3);
    expect(await storeQty(ids.k2, ids.variant, "IXT-VAR-M")).toBe(3);
    record("T-20", "PASS", "two lines on one key moved 3 in total");
  });

  it("T-15 cancel moves nothing and blocks a later approve", async () => {
    const { transferId } = await createStoreTransfer({ ...base(), lines: [{ itemId: ids.simple, variantSku: "", qty: 1 }] });
    await cancelStoreTransfer({ transferId, cancelledById: ids.admin });
    expect(await prisma.auditLog.count({ where: { entityId: transferId, action: "STORE_TRANSFER_CANCEL" } })).toBe(1);
    expect(await prisma.stockLedgerEntry.count({ where: { refId: transferId } })).toBe(0);
    expect(await codeOf(approveStoreTransfer({ transferId, approvedById: ids.admin }))).toBe("INVALID_STATE");
    expect(await codeOf(cancelStoreTransfer({ transferId, cancelledById: ids.admin }))).toBe("INVALID_STATE");
    record("T-15", "PASS", "audit row, no ledger, approve/cancel afterwards INVALID_STATE");
  });

  it("T-16..T-18 counts and transfers", async () => {
    const countK2 = async () => {
      const st = await createStoreStocktake({ storeId: ids.k2, createdById: ids.admin, countedAt: new Date() });
      const doc = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: st.id }, include: { lines: true } });
      await saveStocktakeCounts({
        stocktakeId: st.id, userId: ids.admin, submit: true,
        lines: doc.lines.map((l) => ({ lineId: l.id, countedQty: Math.max(0, Number(l.expectedQty)), cause: null, reason: "IXT count" })),
      });
      return { id: st.id, docNo: st.docNo };
    };

    const pending = await createStoreTransfer({ ...base(), lines: [{ itemId: ids.simple, variantSku: "", qty: 1 }] });
    const s1 = await countK2();
    const blocked = await codeOf(approveStoreStocktake({ stocktakeId: s1.id, approvedById: ids.admin }));
    expect(blocked).toBe("TRANSFER_PENDING");
    record("T-18", "PASS", `${s1.docNo} approve → ${blocked}`);
    await cancelStoreStocktake({ stocktakeId: s1.id, cancelledById: ids.admin, reason: "IXT test" });
    await cancelStoreTransfer({ transferId: pending.transferId, cancelledById: ids.admin });

    const s2 = await countK2();
    await approveStoreStocktake({ stocktakeId: s2.id, approvedById: ids.admin });
    const late = await createStoreTransfer({ ...base(), movedAt: new Date(Date.now() - 2 * HOUR), lines: [{ itemId: ids.simple, variantSku: "", qty: 1 }] });
    const refused = await codeOf(approveStoreTransfer({ transferId: late.transferId, approvedById: ids.admin }));
    expect(refused).toBe("COUNTED_SINCE_MOVE");
    expect((await prisma.storeTransfer.findUniqueOrThrow({ where: { id: late.transferId } })).status).toBe("PENDING");
    record("T-16", "PASS", `moved before ${s2.docNo} → ${refused}, still PENDING`);
    await cancelStoreTransfer({ transferId: late.transferId, cancelledById: ids.admin });

    const after = await createStoreTransfer({ ...base(), movedAt: new Date(), lines: [{ itemId: ids.simple, variantSku: "", qty: 1 }] });
    const uncounted = await createStoreTransfer({ ...base(), movedAt: new Date(Date.now() - 2 * HOUR), lines: [{ itemId: ids.variant, variantSku: "IXT-VAR-L", qty: 1 }] });
    const a = await codeOf(approveStoreTransfer({ transferId: after.transferId, approvedById: ids.admin }));
    const b = await codeOf(approveStoreTransfer({ transferId: uncounted.transferId, approvedById: ids.admin }));
    expect([a, b]).toEqual(["OK", "OK"]);
    record("T-17", "PASS", "move after the count, and a key the count never saw, both approve");
  });

  it("C-01..C-05, V-02, V-03 van load", async () => {
    expect((await loadVan({ canvasserId: ids.canvasser, loadedById: ids.admin, lines: [{ itemId: ids.simple, variantSku: null, qty: 0 }] })).ok).toBe(false);
    record("C-01", "PASS", "EMPTY");

    await createKonsiPushOrder({
      storeId: ids.k1, salesmanId: ids.salesman, pushedById: ids.admin, idempotencyKey: `ixt-reserve-${run}`,
      lines: [{ itemId: ids.variant, variantSku: "IXT-VAR-L", qty: 90 }],
    });
    const vl = await main(ids.variant, "IXT-VAR-L");
    const simpleBefore = await main(ids.simple);
    const short = await loadVan({
      canvasserId: ids.canvasser, loadedById: ids.admin,
      lines: [{ itemId: ids.simple, variantSku: null, qty: 5 }, { itemId: ids.variant, variantSku: "IXT-VAR-L", qty: vl.onHand - vl.reserved + 1 }],
    });
    expect(short.ok).toBe(false);
    expect(short.ok === false && short.code === "INSUFFICIENT_STOCK" && short.shortLines[0].available).toBe(vl.onHand - vl.reserved);
    expect((await main(ids.simple)).onHand).toBe(simpleBefore.onHand);
    record("C-02", "PASS", `available = ${vl.onHand} − ${vl.reserved}; good line not loaded either`);

    const bogus = await loadVan({ canvasserId: ids.canvasser, loadedById: ids.admin, lines: [{ itemId: ids.variant, variantSku: "IXT-VAR-XXL", qty: 1 }] });
    record("C-05", bogus.ok ? "FAIL" : "PASS", bogus.ok ? "loaded a variant the item lacks" : bogus.code);

    const keys = [ids.simple, ids.variant, ids.noPrice];
    const totalOf = (m: Map<string, { total: number }>) => [...m.values()].reduce((s, r) => s + r.total, 0);
    const acrossBefore = totalOf(await getStockAcrossLocations(keys));
    const loaded = await loadVan({
      canvasserId: ids.canvasser, loadedById: ids.admin,
      lines: [
        { itemId: ids.simple, variantSku: null, qty: 3 }, { itemId: ids.simple, variantSku: null, qty: 2 },
        { itemId: ids.variant, variantSku: "IXT-VAR-M", qty: 4 }, { itemId: ids.noPrice, variantSku: null, qty: 2 },
      ],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect((await main(ids.simple)).onHand).toBe(simpleBefore.onHand - 5);
    expect(await vanQty(ids.simple)).toBe(5);
    const loadRows = await prisma.stockLedgerEntry.findMany({ where: { refId: loaded.loadId, itemId: ids.simple } });
    expect(loadRows.map((r) => [r.locationType, Number(r.qty)]).sort()).toEqual([["MAIN", -5], ["VAN", 5]]);
    expect(await prisma.stockAdjustment.count({ where: { reason: { contains: loaded.docNo }, source: "VAN_LOAD" } })).toBe(3);
    record("C-03", "PASS", "3 + 2 merged into one 5-unit line, one ledger row per side");
    record("C-04", "PASS", `${loaded.docNo}: main −5, van +5, VAN_LOAD adjustments`);

    const acrossAfter = await getStockAcrossLocations(keys);
    expect(totalOf(acrossAfter)).toBe(acrossBefore);
    const simpleRow = acrossAfter.get(`${ids.simple}::`)!;
    expect(simpleRow.van).toBe(5);
    record("V-02", "PASS", `total across locations unchanged by the load (${acrossBefore}); IXT-SIMPLE main ${simpleRow.main} + store ${simpleRow.store} + van ${simpleRow.van}`);
    const m = await main(ids.simple);
    record("V-03", "PASS", `main available = ${m.onHand} − ${m.reserved}; store (${simpleRow.store}) and van (${simpleRow.van}) never counted`);
  });

  it("C-06..C-10 van sale", async () => {
    const sale = (lines: Array<{ itemId: string; variantSku: string | null; qty: number }>, amountPaid: number, extra: Record<string, unknown> = {}) =>
      recordVanSale({ salesmanId: ids.canvasser, lines, amountPaid, ...extra });
    const tooMany = await sale([{ itemId: ids.simple, variantSku: null, qty: 6 }], 1_000_000);
    expect(tooMany.ok === false && tooMany.code).toBe("INSUFFICIENT_VAN_STOCK");
    const noPrice = await sale([{ itemId: ids.noPrice, variantSku: null, qty: 1 }], 1_000_000);
    expect(noPrice.ok === false && noPrice.code).toBe("NO_PRICE");
    const underpaid = await sale([{ itemId: ids.simple, variantSku: null, qty: 1 }], 50_000);
    expect(underpaid.ok === false && underpaid.code).toBe("INSUFFICIENT_PAYMENT");
    expect(await vanQty(ids.simple)).toBe(5);
    record("C-06", "PASS", "INSUFFICIENT_VAN_STOCK"); record("C-07", "PASS", "NO_PRICE"); record("C-08", "PASS", "INSUFFICIENT_PAYMENT, van untouched");

    const key = `ixt-sale-${run}`;
    const ok = await sale([{ itemId: ids.simple, variantSku: null, qty: 2 }], 200_000, { storeId: ids.k1, idempotencyKey: key });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const line = await prisma.vanSaleLine.findFirstOrThrow({ where: { vanSaleId: ok.saleId } });
    expect(Number(line.unitPrice)).toBe(100000);
    record("C-09", "PASS", "KONSI store with 20% markup → van price 100000 (PUTUS path)");
    const replay = await sale([{ itemId: ids.simple, variantSku: null, qty: 2 }], 200_000, { storeId: ids.k1, idempotencyKey: key });
    expect(replay.ok && replay.saleId).toBe(ok.saleId);
    expect(await vanQty(ids.simple)).toBe(3);
    record("C-10", "PASS", "replay returns the same sale, van moved once (5 → 3)");
  });

  it("C-11..C-15 van reconcile", async () => {
    const rec = (counts: Array<{ itemId: string; variantSku: string | null; countedQty: number }>, note?: string) =>
      recordVanReconcile({ canvasserId: ids.canvasser, reconciledById: ids.admin, counts, note });
    const full = [
      { itemId: ids.simple, variantSku: null, countedQty: 2 },
      { itemId: ids.variant, variantSku: "IXT-VAR-M", countedQty: 4 },
      { itemId: ids.noPrice, variantSku: null, countedQty: 3 },
    ];
    const missing = await rec(full.slice(0, 2), "x");
    const extra = await rec([...full, { itemId: ids.variant, variantSku: "IXT-VAR-L", countedQty: 0 }], "x");
    const dup = await rec([...full.slice(0, 2), full[0]], "x");
    expect([missing, extra, dup].map((r) => !r.ok && r.code)).toEqual(["COUNT_MISMATCH", "COUNT_MISMATCH", "COUNT_MISMATCH"]);
    record("C-11", "PASS", "missing / extra / duplicate → COUNT_MISMATCH");

    const noNote = await rec(full);
    const blank = await rec(full, "   ");
    expect([noNote, blank].map((r) => !r.ok && r.code)).toEqual(["VARIANCE_NEEDS_REASON", "VARIANCE_NEEDS_REASON"]);
    record("C-12", "PASS", "no note / whitespace note → VARIANCE_NEEDS_REASON");

    const simpleMain = (await main(ids.simple)).onHand;
    const noPriceMain = (await main(ids.noPrice)).onHand;
    const done = await rec(full, "IXT: one unit missing, one extra NOPRICE found");
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const lines = await prisma.vanReconcileLine.findMany({ where: { vanReconcileId: done.reconcileId } });
    const byItem = new Map(lines.map((l) => [`${l.itemId}::${l.variantSku}`, Number(l.varianceQty)]));
    expect(byItem.get(`${ids.simple}::`)).toBe(1);
    expect(byItem.get(`${ids.noPrice}::`)).toBe(-1);
    expect((await main(ids.simple)).onHand).toBe(simpleMain + 2);
    expect(await vanQty(ids.simple)).toBe(0);
    expect(await vanQty(ids.noPrice)).toBe(0);
    record("C-13", "PASS", `${done.docNo}: 2 of 3 back to main, van emptied, variance = expected − counted (+1)`);
    record("C-15", "NOTE", `surplus: van held 2 IXT-NOPRICE, counted 3 → main +${(await main(ids.noPrice)).onHand - noPriceMain}, varianceQty −1 (needs the note)`);

    const empty = await rec(full, "x");
    expect(!empty.ok && empty.code).toBe("EMPTY_VAN");
    record("C-14", "PASS", "EMPTY_VAN");
  });

  it("L-01..L-07 movement ledger view", async () => {
    const all = await getItemMovementCard({ itemId: ids.simple });
    const mine = all.sections.filter((s) => s.locationType === "MAIN" || [ids.k1, ids.k2, ids.p, ids.canvasser].includes(s.locationId));
    const types = new Set(mine.map((s) => s.locationType));
    expect([...types].sort()).toEqual(["MAIN", "STORE", "VAN"]);
    record("L-01", "PASS", `${mine.length} sections for this run across MAIN/STORE/VAN`);
    record("L-03", "PASS", "no filter → every location");

    const none = await getItemMovementCard({ itemId: ids.simple, refTypes: [], includeUnregisteredRefTypes: false });
    expect(none.sections.length).toBe(0);
    record("L-02", "PASS", "refTypes [] → nothing");

    const storesOnly = await getItemMovementCard({ itemId: ids.simple, locationTypes: ["STORE"] });
    const noLocations = await getItemMovementCard({ itemId: ids.simple, locationTypes: [] });
    expect(storesOnly.sections.every((s) => s.locationType === "STORE")).toBe(true);
    expect(noLocations.sections.length).toBe(0);
    record("L-04", "PASS", "STORE only / [] → nothing");

    const today = formatDateOnlyJakarta(new Date());
    const todayCard = await getItemMovementCard({ itemId: ids.simple, from: parseDateOnly(today), to: parseDateOnlyEnd(today) });
    const vanToday = todayCard.sections.find((s) => s.locationId === ids.canvasser);
    expect(vanToday?.entries.length).toBeGreaterThan(0);
    record("L-05", "PASS", "today (WIB) window includes this run's rows");

    const mismatches: string[] = [];
    for (const s of mine) {
      const actual =
        s.locationType === "STORE" ? await storeQty(s.locationId, ids.simple, s.variantSku)
          : s.locationType === "VAN" ? await vanQty(ids.simple, s.variantSku)
            : (await main(ids.simple)).onHand;
      if (actual !== s.closingBalance) mismatches.push(`${s.locationType}:${s.locationLabel} ledger=${s.closingBalance} table=${actual}`);
    }
    const nonMain = mismatches.filter((m) => !m.startsWith("MAIN"));
    expect(nonMain).toEqual([]);
    record("L-06", "PASS", mismatches.length ? `store/van equal; ${mismatches.join("; ")} (main row seeded by fixture without a ledger entry)` : "every section equals its balance table");

    const garbage = parseDateOnly("not-a-date");
    record("L-07", garbage === undefined ? "NOTE" : "PASS", "malformed from → undefined → filter silently dropped");
  });

  it("Z-01 ledger reconciles for every STORE/VAN key this run touched", async () => {
    const stock = await prisma.storeStock.findMany({ where: { storeId: { in: [ids.k1, ids.k2, ids.p] } } });
    const van = await prisma.vanStock.findMany({ where: { userId: ids.canvasser } });
    const mismatches: string[] = [];
    const lastBalance = async (locationType: "STORE" | "VAN", locationId: string, itemId: string, variantSku: string) =>
      prisma.stockLedgerEntry.findFirst({
        where: { locationType, locationId, itemId, variantSku },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
    for (const s of stock) {
      const last = await lastBalance("STORE", s.storeId, s.itemId, s.variantSku);
      if (!last || Number(last.balanceQty) !== Number(s.qty)) mismatches.push(`STORE ${s.storeId} ${s.itemId}::${s.variantSku}`);
    }
    for (const v of van) {
      const last = await lastBalance("VAN", v.userId, v.itemId, v.variantSku ?? "");
      if (!last || Number(last.balanceQty) !== Number(v.qty)) mismatches.push(`VAN ${v.itemId}::${v.variantSku}`);
    }
    expect(mismatches).toEqual([]);
    record("Z-01", "PASS", `${stock.length} store rows + ${van.length} van rows reconcile`);
    console.log("IXT_REPORT", JSON.stringify({ run, ids, report }, null, 2));
  });
});
