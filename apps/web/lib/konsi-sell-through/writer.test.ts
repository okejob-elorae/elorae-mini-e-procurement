import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId, type Prisma } from "@elorae/db";
import { createSellThrough, resolveSellThroughLine, approveSellThrough, cancelSellThrough } from "./writer";
import { createSellThroughFixtures } from "./test-fixtures";
import { approveStoreStocktake } from "@/lib/stores/stocktake/writer";

/* Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/* Stubbed so the order-create fan-out cannot queue push notifications on the shared dev DB. */
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

/**
 * A pass-through seam on `runSerializable`: while `txSeam.wrap` is set, the writer's transaction
 * client is handed through it first. It exists for the CAS-loser case alone. A serializable read
 * is a locking read, so no concurrent write can land between approve's read and its CAS — the
 * only way to reach `flipped.count === 0` is to let the read report a stale status. A spy on the
 * base client's delegate would not reach inside the transaction, whose client is its own object.
 */
const txSeam = vi.hoisted(() => ({ wrap: null as null | ((tx: Prisma.TransactionClient) => Prisma.TransactionClient) }));
vi.mock("@/lib/db/tx-retry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/tx-retry")>();
  return {
    ...actual,
    runSerializable: <T>(cb: (tx: Prisma.TransactionClient) => Promise<T>) =>
      actual.runSerializable((tx) => cb(txSeam.wrap ? txSeam.wrap(tx) : tx)),
  };
});

/* Serves every konsiSellThrough.findUnique through the real client, then reports the row as still DRAFT. */
const withStaleDraftRead = (tx: Prisma.TransactionClient): Prisma.TransactionClient =>
  new Proxy(tx, {
    get(target, prop) {
      if (prop !== "konsiSellThrough") return Reflect.get(target, prop);
      const delegate = target.konsiSellThrough;
      return new Proxy(delegate, {
        get(d, p) {
          if (p !== "findUnique") return Reflect.get(d, p);
          return async (args: unknown) => {
            const row = (await d.findUnique(args as never)) as Record<string, unknown> | null;
            return row ? { ...row, status: "DRAFT" } : row;
          };
        },
      });
    },
  });

/* Every case drives several real serializable writers end to end, well past vitest's 5s default. */
const SLOW = 60_000;

d("konsi sell-through writer (test bed only)", () => {
  const fx = createSellThroughFixtures();
  const { state, tick, setMethod, transferIn, spgSell, count, raiseRetur, settleRetur, onlyLine } = fx;

  beforeEach(fx.beforeEach);
  afterEach(fx.afterEach);

  /* create — preconditions */

  it("refuses NOT_FOUND for a stocktake that does not exist", async () => {
    await expect(createSellThrough({ closingStocktakeId: `missing-${state.run}`, createdById: state.userId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, SLOW);

  it("refuses STOCKTAKE_NOT_APPROVED for a submitted count that was never approved", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(6, { approve: false });
    await expect(createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId })).rejects.toMatchObject({ code: "STOCKTAKE_NOT_APPROVED" });
  }, SLOW);

  it("refuses NOT_FULL_COUNT for an approved count that left a line uncounted", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(null);
    await expect(createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId })).rejects.toMatchObject({ code: "NOT_FULL_COUNT" });
  }, SLOW);

  it("refuses NOT_KONSI when the store is no longer a consignment store", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(6);
    /* Direct flip for the test only — the store edit writer would also clear the method; left set here so NOT_KONSI is the only failing precondition. */
    await prisma.store.update({ where: { id: state.storeId }, data: { termsType: "PUTUS" } });
    await expect(createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId })).rejects.toMatchObject({ code: "NOT_KONSI" });
  }, SLOW);

  it("refuses METHOD_NOT_SET for a KONSI store with no sell-through method", async () => {
    await transferIn(6);
    const stocktakeId = await count(6);
    await expect(createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId })).rejects.toMatchObject({ code: "METHOD_NOT_SET" });
  }, SLOW);

  it("refuses ALREADY_USED for a stocktake that already closes a report", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(6);
    await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    await expect(createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId })).rejects.toMatchObject({ code: "ALREADY_USED" });
  }, SLOW);

  it("refuses DRAFT_EXISTS while an earlier report of the store is still DRAFT", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const first = await count(6);
    await createSellThrough({ closingStocktakeId: first, createdById: state.userId });
    await tick();
    const second = await count(6);
    await expect(createSellThrough({ closingStocktakeId: second, createdById: state.userId })).rejects.toMatchObject({ code: "DRAFT_EXISTS" });
  }, SLOW);

  it("refuses OUT_OF_ORDER for a stocktake approved before the previous report's closing stocktake", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    /* Both counts match the ledger (6 of 6), so neither writes a row and each boundary is its approvedAt: earlier < later. */
    const earlier = await count(6);
    await tick();
    const later = await count(6);
    const report = await createSellThrough({ closingStocktakeId: later, createdById: state.userId });
    await approveSellThrough({ id: report.id, approvedById: state.userId });
    await expect(createSellThrough({ closingStocktakeId: earlier, createdById: state.userId })).rejects.toMatchObject({ code: "OUT_OF_ORDER" });
  }, SLOW);

  it("refuses UNKNOWN_REF_TYPE for a store ledger row outside the classified set, naming the refType", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(6);
    const { approvedAt } = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(stocktakeId) }, select: { approvedAt: true } });
    /* Inserted directly — no real writer produces an unclassified refType — one second inside the window. */
    await prisma.stockLedgerEntry.create({
      data: {
        locationType: "STORE",
        locationId: state.storeId,
        itemId: state.itemId,
        variantSku: "",
        type: "ADJUSTMENT",
        qty: 1,
        balanceQty: 7,
        refType: "LegacyMystery",
        refId: `TEST-KSTW-MYSTERY-${state.run}`,
        refDocNumber: `MYSTERY/${state.run}`,
        createdAt: new Date(approvedAt!.getTime() - 1000),
      },
    });
    await expect(createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId })).rejects.toMatchObject({
      code: "UNKNOWN_REF_TYPE",
      detail: "LegacyMystery",
    });
  }, SLOW);

  it("refuses BEFORE_LEDGER_CUTOVER for a count whose boundary precedes the store's first ledger row", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    /* A matching count writes no ledger row, so its boundary is its approvedAt — moved a day before the transfer, test-only. */
    const stocktakeId = await count(6);
    const earliest = await prisma.stockLedgerEntry.findFirstOrThrow({
      where: { locationType: "STORE", locationId: seededId(state.storeId) },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const before = new Date(earliest.createdAt.getTime() - 86_400_000);
    await prisma.storeStocktake.update({ where: { id: stocktakeId }, data: { approvedAt: before, countFinishedAt: before } });
    await expect(createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId })).rejects.toMatchObject({ code: "BEFORE_LEDGER_CUTOVER" });
  }, SLOW);

  /* create — returns in flight at the closing count */

  it("refuses RETUR_IN_FLIGHT while a retur raised before the count is unsettled, still refuses that count once the retur settles after it, and a later count bills the returned units 0", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    /* The salesman takes 2 back before the count; StoreStock still holds 6 until the retur is approved. */
    const { returnId, docNo } = await raiseRetur(2);
    await tick();
    const contaminated = await count(4, { cause: "SHRINKAGE", reason: "two units off the shelf" });
    await expect(createSellThrough({ closingStocktakeId: contaminated, createdById: state.userId })).rejects.toMatchObject({
      code: "RETUR_IN_FLIGHT",
      detail: docNo,
    });

    /* Settling it after the count does not clean the count — it saw 2 fewer units than StoreStock held. */
    await tick();
    await settleRetur(returnId);
    await expect(createSellThrough({ closingStocktakeId: contaminated, createdById: state.userId })).rejects.toMatchObject({
      code: "RETUR_IN_FLIGHT",
      detail: docNo,
    });

    /* StoreStock 4 − 2 = 2; the shelf still holds 4, so the later count finds a +2 surplus that nets out the earlier −2. */
    await tick();
    const closing = await count(4, { reason: "the earlier count missed the returned units" });
    const { id } = await createSellThrough({ closingStocktakeId: closing, createdById: state.userId });
    const line = await onlyLine(id);
    /* opening 0 + in 6 − out 2 − pos 0 − gap (2 − 2 = 0) = closing 4; billed = 0 + 6 − 2 − 4 = 0. */
    expect(Number(line.inQty)).toBe(6);
    expect(Number(line.outQty)).toBe(2);
    expect(Number(line.gapQty)).toBe(0);
    expect(Number(line.closingQty)).toBe(4);
    expect(Number(line.billedQty)).toBe(0);
  }, SLOW);

  it("does not refuse over a retur that was raised and settled before the count", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const { returnId } = await raiseRetur(2);
    await settleRetur(returnId);
    await tick();
    const stocktakeId = await count(4);
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    const line = await onlyLine(id);
    expect(Number(line.outQty)).toBe(2);
    expect(Number(line.billedQty)).toBe(0);
  }, SLOW);

  it("approve refuses RETUR_IN_FLIGHT when an unsettled retur raised before the count reaches a DRAFT", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(6);
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });

    /* Stands in for a DRAFT created before this rule existed: the retur's createdAt is moved before the count, test-only. */
    const { returnId, docNo } = await raiseRetur(1);
    const { countFinishedAt } = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(stocktakeId) }, select: { countFinishedAt: true } });
    await prisma.fieldReturn.update({ where: { id: returnId }, data: { createdAt: new Date(countFinishedAt!.getTime() - 1000) } });

    await expect(approveSellThrough({ id, approvedById: state.userId })).rejects.toMatchObject({ code: "RETUR_IN_FLIGHT", detail: docNo });
    expect((await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) } })).status).toBe("DRAFT");
  }, SLOW);

  /* SHELF_COUNT */

  it("SHELF_COUNT: 6 transferred in, 2 counted → one line billed 4, and approve succeeds with no resolution", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    /* Expected 6, counted 2 → the stocktake writes a −4 store row, i.e. gapQty 4. */
    const stocktakeId = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });

    const { id, docNo } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    expect(docNo.startsWith("SLT/")).toBe(true);

    const doc = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) }, include: { lines: true } });
    const ownRow = await prisma.stockLedgerEntry.findFirstOrThrow({
      where: { locationType: "STORE", locationId: seededId(state.storeId), refType: "StoreStocktake", refId: seededId(stocktakeId) },
      orderBy: { createdAt: "desc" },
    });
    expect(doc.status).toBe("DRAFT");
    expect(doc.method).toBe("SHELF_COUNT");
    expect(doc.storeId).toBe(state.storeId);
    expect(doc.closingStocktakeId).toBe(stocktakeId);
    expect(doc.stocktakeKey).toBe(stocktakeId);
    expect(doc.chainKey).toBe(`${state.storeId}:root`);
    expect(doc.previousId).toBeNull();
    expect(doc.periodStart).toBeNull();
    expect(doc.periodEnd.toISOString()).toBe(ownRow.createdAt.toISOString());
    expect(doc.lines).toHaveLength(1);

    /* opening 0 + in 6 − out 0 − pos 0 − gap 4 = closing 2; billed = opening + in − out − counted = 0 + 6 − 0 − 2 = 4. */
    const line = doc.lines[0];
    expect(line.itemId).toBe(state.itemId);
    expect(line.variantSku).toBe("");
    expect(line.productName).toBe("Sell-through item");
    expect(Number(line.openingQty)).toBe(0);
    expect(Number(line.inQty)).toBe(6);
    expect(Number(line.outQty)).toBe(0);
    expect(Number(line.posSoldQty)).toBe(0);
    expect(Number(line.gapQty)).toBe(4);
    expect(Number(line.closingQty)).toBe(2);
    expect(Number(line.countedQty)).toBe(2);
    expect(Number(line.billedQty)).toBe(4);
    expect(Number(line.shrinkageQty)).toBe(0);
    expect(line.negativeSold).toBe(false);
    expect(line.suggestedResolution).toBeNull();
    expect(line.resolution).toBeNull();
    expect(Number(line.unitCost)).toBe(10000);

    await approveSellThrough({ id, approvedById: state.userId });
    const approved = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) } });
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedById).toBe(state.userId);
    expect(approved.approvedAt).not.toBeNull();
  }, SLOW);

  /* SPG_POS — hold and resolution */

  it("SPG_POS: POS sells 3 and the count finds 2 more gone → prefilled SHRINKAGE, HELD until resolved, then approves", async () => {
    await setMethod("SPG_POS");
    await transferIn(6);
    await spgSell(3);
    /* StoreStock 6 − 3 = 3 expected; counted 1 → −2 store row, gapQty 2. */
    const stocktakeId = await count(1, { cause: "SHRINKAGE", reason: "two units missing" });

    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    const line = await onlyLine(id);
    /* opening 0 + in 6 − out 0 − pos 3 − gap 2 = closing 1; billed starts at POS 3. */
    expect(Number(line.inQty)).toBe(6);
    expect(Number(line.posSoldQty)).toBe(3);
    expect(Number(line.gapQty)).toBe(2);
    expect(Number(line.closingQty)).toBe(1);
    expect(Number(line.countedQty)).toBe(1);
    expect(Number(line.billedQty)).toBe(3);
    expect(line.suggestedResolution).toBe("SHRINKAGE");
    expect(line.resolution).toBeNull();

    await expect(approveSellThrough({ id, approvedById: state.userId })).rejects.toMatchObject({ code: "HELD" });
    expect((await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) } })).status).toBe("DRAFT");

    await resolveSellThroughLine({ lineId: line.id, resolution: "SHRINKAGE", reason: "confirmed theft", userId: state.userId });
    const resolved = await onlyLine(id);
    /* SHRINKAGE keeps billed at POS 3 and books the gap 2 as Elorae's loss. */
    expect(resolved.resolution).toBe("SHRINKAGE");
    expect(resolved.resolutionReason).toBe("confirmed theft");
    expect(Number(resolved.billedQty)).toBe(3);
    expect(Number(resolved.shrinkageQty)).toBe(2);

    await approveSellThrough({ id, approvedById: state.userId });
    expect((await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) } })).status).toBe("APPROVED");
  }, SLOW);

  it("SPG_POS: a POS sale while the count waits for approval is carried through it — no gap on the line, billed = POS", async () => {
    await setMethod("SPG_POS");
    await transferIn(6);
    /* The shelf is counted at 6, then POS sells 2 before an admin approves the count. */
    const stocktakeId = await count(6, { approve: false });
    await tick();
    await spgSell(2);
    await approveStoreStocktake({ stocktakeId, approvedById: state.userId });

    const stock = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(state.storeId), itemId: seededId(state.itemId) } });
    expect(Number(stock.qty)).toBe(4);

    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    const line = await onlyLine(id);
    /* opening 0 + in 6 − out 0 − pos 2 − gap 0 = closing 4; before the fix the approval re-set 6 and wrote a +2 phantom surplus. */
    expect(Number(line.inQty)).toBe(6);
    expect(Number(line.posSoldQty)).toBe(2);
    expect(Number(line.gapQty)).toBe(0);
    expect(Number(line.closingQty)).toBe(4);
    expect(Number(line.billedQty)).toBe(2);
    expect(line.suggestedResolution).toBeNull();

    await approveSellThrough({ id, approvedById: state.userId });
    expect((await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) } })).status).toBe("APPROVED");
  }, SLOW);

  it("resolve refuses a missing reason, the wrong arm, an over-long reason, an unknown line and a non-DRAFT report", async () => {
    await setMethod("SPG_POS");
    await transferIn(6);
    await spgSell(3);
    const stocktakeId = await count(1, { cause: "SHRINKAGE", reason: "two units missing" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    const line = await onlyLine(id);

    await expect(resolveSellThroughLine({ lineId: line.id, resolution: "SHRINKAGE", reason: "   ", userId: state.userId })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    /* A shortfall (gap 2 > 0) resolves only as BILL or SHRINKAGE; BILL_POS is the surplus arm. */
    await expect(resolveSellThroughLine({ lineId: line.id, resolution: "BILL_POS", reason: null, userId: state.userId })).rejects.toMatchObject({ code: "INVALID_RESOLUTION" });
    await expect(resolveSellThroughLine({ lineId: line.id, resolution: "SHRINKAGE", reason: "x".repeat(1001), userId: state.userId })).rejects.toMatchObject({
      code: "INVALID_RESOLUTION",
      detail: "REASON_TOO_LONG",
    });
    await expect(resolveSellThroughLine({ lineId: `missing-${state.run}`, resolution: "BILL", reason: null, userId: state.userId })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const untouched = await onlyLine(id);
    expect(untouched.resolution).toBeNull();
    expect(Number(untouched.billedQty)).toBe(3);

    /* BILL: billed = POS 3 + gap 2 = 5. */
    await resolveSellThroughLine({ lineId: line.id, resolution: "BILL", reason: null, userId: state.userId });
    expect(Number((await onlyLine(id)).billedQty)).toBe(5);

    await approveSellThrough({ id, approvedById: state.userId });
    await expect(resolveSellThroughLine({ lineId: line.id, resolution: "SHRINKAGE", reason: "too late", userId: state.userId })).rejects.toMatchObject({ code: "INVALID_STATE" });
  }, SLOW);

  /* approve — STALE and CAS */

  it("approve refuses STALE when a movement lands inside the window after the report was created", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    const doc = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) } });

    /**
     * The real writer stamps the sale "now", after the boundary. Its ledger row is moved one
     * second inside the window — test-only — to stand in for a movement that belongs to the
     * period but committed after creation (a late-approved retur, say). Recomputed: pos 1,
     * closing 0 + 6 − 0 − 1 − 4 = 1, against the stored pos 0 / closing 2.
     */
    const saleId = await spgSell(1);
    const saleRow = await prisma.stockLedgerEntry.findFirstOrThrow({
      where: { locationType: "STORE", locationId: seededId(state.storeId), refType: "SpgSale", refId: seededId(saleId) },
    });
    await prisma.stockLedgerEntry.update({ where: { id: saleRow.id }, data: { createdAt: new Date(doc.periodEnd.getTime() - 1000) } });

    await expect(approveSellThrough({ id, approvedById: state.userId })).rejects.toMatchObject({ code: "STALE" });
    expect((await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) } })).status).toBe("DRAFT");
  }, SLOW);

  it("approve refuses STALE ahead of HELD, so a report that must be recreated never asks for resolutions first", async () => {
    await setMethod("SPG_POS");
    await transferIn(6);
    await spgSell(3);
    /* Gap 2 and unresolved, so the line holds. */
    const stocktakeId = await count(1, { cause: "SHRINKAGE", reason: "two units missing" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    const doc = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) } });

    /* Test-only: a later sale's row moved one second inside the window, standing in for a movement that committed after creation. */
    const saleId = await spgSell(1);
    const saleRow = await prisma.stockLedgerEntry.findFirstOrThrow({
      where: { locationType: "STORE", locationId: seededId(state.storeId), refType: "SpgSale", refId: seededId(saleId) },
    });
    await prisma.stockLedgerEntry.update({ where: { id: saleRow.id }, data: { createdAt: new Date(doc.periodEnd.getTime() - 1000) } });

    await expect(approveSellThrough({ id, approvedById: state.userId })).rejects.toMatchObject({ code: "STALE" });
  }, SLOW);

  it("approve refuses NOT_KONSI when the store left consignment terms while the report was DRAFT", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(6);
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    /* Direct flip for the test only — the store edit writer refuses this switch while a report is DRAFT. */
    await prisma.store.update({ where: { id: state.storeId }, data: { termsType: "PUTUS" } });
    await expect(approveSellThrough({ id, approvedById: state.userId })).rejects.toMatchObject({ code: "NOT_KONSI" });
    expect((await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) } })).status).toBe("DRAFT");
  }, SLOW);

  it("approve moves no stock: every StoreStock row and the store's ledger row count are unchanged", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });

    const stockOf = () =>
      prisma.storeStock.findMany({
        where: { storeId: seededId(state.storeId) },
        orderBy: [{ itemId: "asc" }, { variantSku: "asc" }],
        select: { itemId: true, variantSku: true, qty: true, avgCost: true },
      });
    const ledgerCountOf = () => prisma.stockLedgerEntry.count({ where: { locationType: "STORE", locationId: seededId(state.storeId) } });
    const stockBefore = await stockOf();
    const ledgerBefore = await ledgerCountOf();

    await approveSellThrough({ id, approvedById: state.userId });

    expect((await stockOf()).map((r) => ({ ...r, qty: Number(r.qty), avgCost: Number(r.avgCost) }))).toEqual(
      stockBefore.map((r) => ({ ...r, qty: Number(r.qty), avgCost: Number(r.avgCost) })),
    );
    expect(await ledgerCountOf()).toBe(ledgerBefore);
  }, SLOW);

  it("approve that loses the status CAS refuses INVALID_STATE and approves nothing", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });

    /* A concurrent cancel that committed before the CAS; approve's own read is made to report the stale DRAFT. */
    await prisma.konsiSellThrough.update({ where: { id }, data: { status: "CANCELLED" } });
    txSeam.wrap = withStaleDraftRead;
    try {
      await expect(approveSellThrough({ id, approvedById: state.userId })).rejects.toMatchObject({ code: "INVALID_STATE" });
    } finally {
      txSeam.wrap = null;
    }

    const doc = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) } });
    expect(doc.status).toBe("CANCELLED");
    expect(doc.approvedById).toBeNull();
    expect(doc.approvedAt).toBeNull();
  }, SLOW);

  it("reads the method snapshotted at creation: switching the store to SHELF_COUNT does not release a held SPG_POS line", async () => {
    await setMethod("SPG_POS");
    await transferIn(6);
    await spgSell(3);
    const stocktakeId = await count(1, { cause: "SHRINKAGE", reason: "two units missing" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });

    await setMethod("SHELF_COUNT");

    await expect(approveSellThrough({ id, approvedById: state.userId })).rejects.toMatchObject({ code: "HELD" });
    const doc = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) } });
    expect(doc.method).toBe("SPG_POS");
    expect(doc.status).toBe("DRAFT");
    expect(Number((await onlyLine(id)).billedQty)).toBe(3);
  }, SLOW);

  it("a second approve of the same report refuses INVALID_STATE", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    await approveSellThrough({ id, approvedById: state.userId });
    await expect(approveSellThrough({ id, approvedById: state.userId })).rejects.toMatchObject({ code: "INVALID_STATE" });
  }, SLOW);

  /* chain */

  it("chains: report 2's openings equal report 1's closingQty and its period starts at report 1's end", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    /* Report 1: opening 0 + in 6 − gap 4 = closing 2. */
    const first = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const r1 = await createSellThrough({ closingStocktakeId: first, createdById: state.userId });
    await approveSellThrough({ id: r1.id, approvedById: state.userId });
    const r1Doc = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(r1.id) }, include: { lines: true } });
    expect(Number(r1Doc.lines[0].closingQty)).toBe(2);

    await tick();
    await spgSell(1);
    await tick();
    /**
     * StoreStock 2 − 1 = 1 expected, counted 1: an unchanged line writes no ledger row, so this
     * stocktake's boundary falls back to its approvedAt.
     */
    const second = await count(1);
    const r2 = await createSellThrough({ closingStocktakeId: second, createdById: state.userId });
    const r2Doc = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(r2.id) }, include: { lines: true } });
    expect(r2Doc.previousId).toBe(r1.id);
    expect(r2Doc.chainKey).toBe(`${state.storeId}:${r1.id}`);
    expect(r2Doc.periodStart?.toISOString()).toBe(r1Doc.periodEnd.toISOString());
    expect(r2Doc.lines).toHaveLength(1);

    /* opening 2 (report 1's closing) + in 0 − out 0 − pos 1 − gap 0 = closing 1; SHELF_COUNT billed = 2 + 0 − 0 − 1 = 1. */
    const line = r2Doc.lines[0];
    expect(Number(line.openingQty)).toBe(Number(r1Doc.lines[0].closingQty));
    expect(Number(line.inQty)).toBe(0);
    expect(Number(line.posSoldQty)).toBe(1);
    expect(Number(line.gapQty)).toBe(0);
    expect(Number(line.closingQty)).toBe(1);
    expect(Number(line.billedQty)).toBe(1);

    await approveSellThrough({ id: r2.id, approvedById: state.userId });
    expect((await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(r2.id) } })).status).toBe("APPROVED");
  }, SLOW);

  /* cancel */

  it("cancel requires a reason, frees the closing stocktake for a new report, and refuses a second cancel", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const first = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });

    await expect(cancelSellThrough({ id: first.id, cancelledById: state.userId, reason: "   " })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await expect(cancelSellThrough({ id: first.id, cancelledById: state.userId, reason: "x".repeat(1001) })).rejects.toMatchObject({
      code: "REASON_REQUIRED",
      detail: "REASON_TOO_LONG",
    });

    await cancelSellThrough({ id: first.id, cancelledById: state.userId, reason: "  wrong count  " });
    const cancelled = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(first.id) } });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledById).toBe(state.userId);
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(cancelled.cancelReason).toBe("wrong count");
    expect(cancelled.stocktakeKey).toBeNull();
    expect(cancelled.chainKey).toBeNull();
    expect(cancelled.closingStocktakeId).toBe(stocktakeId);

    await expect(cancelSellThrough({ id: first.id, cancelledById: state.userId, reason: "again" })).rejects.toMatchObject({ code: "INVALID_STATE" });

    const second = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    expect(second.id).not.toBe(first.id);
    const recreated = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(second.id) } });
    expect(recreated.status).toBe("DRAFT");
    expect(recreated.stocktakeKey).toBe(stocktakeId);
    expect(recreated.chainKey).toBe(`${state.storeId}:root`);
  }, SLOW);
});
