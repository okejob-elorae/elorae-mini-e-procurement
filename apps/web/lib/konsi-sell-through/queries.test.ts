import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createSellThrough, resolveSellThroughLine, cancelSellThrough } from "./writer";
import { createSellThroughFixtures } from "./test-fixtures";
import { listSellThroughs, getSellThrough, getSellThroughEligibility } from "./queries";

/* Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/* Stubbed so the order-create fan-out cannot queue push notifications on the shared dev DB. */
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

/* Every case drives several real serializable writers end to end, well past vitest's 5s default. */
const SLOW = 60_000;

d("konsi sell-through queries (test bed only)", () => {
  const fx = createSellThroughFixtures();
  const { state, tick, setMethod, transferIn, spgSell, count, raiseRetur } = fx;

  beforeEach(fx.beforeEach);
  afterEach(fx.afterEach);

  /* listSellThroughs */

  it("lists by storeId, filters by status, and paginates newest-first", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    /* Expected 6, counted 2 → the stocktake writes a −4 store row, i.e. gapQty 4. */
    const firstStocktake = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const r1 = await createSellThrough({ closingStocktakeId: firstStocktake, createdById: state.userId });
    await fx.approve(r1.id);

    await tick();
    /* StoreStock now 2 (unchanged from report 1's closing); a matching count writes no ledger row. */
    const secondStocktake = await count(2);
    const r2 = await createSellThrough({ closingStocktakeId: secondStocktake, createdById: state.userId });

    const all = await listSellThroughs({ storeId: state.storeId, page: 1, pageSize: 10 });
    expect(all.total).toBe(2);
    expect(all.items.map((i) => i.id)).toEqual([r2.id, r1.id]);

    const page1 = await listSellThroughs({ storeId: state.storeId, page: 1, pageSize: 1 });
    expect(page1.total).toBe(2);
    expect(page1.items).toHaveLength(1);
    expect(page1.items[0].id).toBe(r2.id);

    const page2 = await listSellThroughs({ storeId: state.storeId, page: 2, pageSize: 1 });
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0].id).toBe(r1.id);

    const approvedOnly = await listSellThroughs({ storeId: state.storeId, status: "APPROVED", page: 1, pageSize: 10 });
    expect(approvedOnly.items.map((i) => i.id)).toEqual([r1.id]);
    expect(approvedOnly.items[0].storeName).toBe("Test Sell-through Store");
    expect(approvedOnly.items[0].method).toBe("SHELF_COUNT");
    expect(approvedOnly.items[0].heldCount).toBe(0);
    /* opening 0 + in 6 − gap 4 = closing 2; SHELF_COUNT billed = 0 + 6 − 0 − 2 = 4. */
    expect(approvedOnly.items[0].billedTotalQty).toBe(4);

    const draftOnly = await listSellThroughs({ storeId: state.storeId, status: "DRAFT", page: 1, pageSize: 10 });
    expect(draftOnly.items.map((i) => i.id)).toEqual([r2.id]);

    const otherStore = await listSellThroughs({ storeId: `missing-store-${state.run}`, page: 1, pageSize: 10 });
    expect(otherStore).toEqual({ items: [], total: 0 });
  }, SLOW);

  it("computes heldCount for a SPG_POS report and clears it once the gap line is resolved", async () => {
    await setMethod("SPG_POS");
    await transferIn(6);
    await spgSell(3);
    /* StoreStock 6 − 3 = 3 expected; counted 1 → gapQty 2, unresolved. */
    const stocktakeId = await count(1, { cause: "SHRINKAGE", reason: "two units missing" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });

    const held = await listSellThroughs({ storeId: state.storeId, page: 1, pageSize: 10 });
    expect(held.items).toHaveLength(1);
    expect(held.items[0].heldCount).toBe(1);
    expect(held.items[0].billedTotalQty).toBe(3);

    const line = await prisma.konsiSellThroughLine.findFirstOrThrow({ where: { sellThroughId: id } });
    await resolveSellThroughLine({ lineId: line.id, resolution: "SHRINKAGE", reason: "confirmed theft", userId: state.userId });

    const resolved = await listSellThroughs({ storeId: state.storeId, page: 1, pageSize: 10 });
    expect(resolved.items[0].heldCount).toBe(0);
    /* SHRINKAGE keeps billed at POS 3. */
    expect(resolved.items[0].billedTotalQty).toBe(3);
  }, SLOW);

  it("counts held lines on a DRAFT report only — a cancelled report with an unresolved gap shows 0", async () => {
    await setMethod("SPG_POS");
    await transferIn(6);
    await spgSell(3);
    const stocktakeId = await count(1, { cause: "SHRINKAGE", reason: "two units missing" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    await cancelSellThrough({ id, cancelledById: state.userId, reason: "recount needed" });

    const list = await listSellThroughs({ storeId: state.storeId, page: 1, pageSize: 10 });
    expect(list.items).toHaveLength(1);
    expect(list.items[0].status).toBe("CANCELLED");
    expect(list.items[0].heldCount).toBe(0);
  }, SLOW);

  /* getSellThrough */

  it("returns null for a report that does not exist", async () => {
    expect(await getSellThrough(`missing-${state.run}`)).toBeNull();
  }, SLOW);

  it("returns the doc fields, store name, closing stocktake docNo, and one held SPG_POS line", async () => {
    await setMethod("SPG_POS");
    await transferIn(6);
    await spgSell(3);
    const stocktakeId = await count(1, { cause: "SHRINKAGE", reason: "two units missing" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    const stocktake = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: stocktakeId }, select: { docNo: true } });

    const detail = await getSellThrough(id);
    expect(detail).not.toBeNull();
    expect(detail!.storeId).toBe(state.storeId);
    expect(detail!.storeName).toBe("Test Sell-through Store");
    expect(detail!.method).toBe("SPG_POS");
    expect(detail!.status).toBe("DRAFT");
    expect(detail!.closingStocktakeId).toBe(stocktakeId);
    expect(detail!.closingStocktakeDocNo).toBe(stocktake.docNo);
    expect(detail!.previousId).toBeNull();
    expect(detail!.previousDocNo).toBeNull();
    expect(detail!.lines).toHaveLength(1);

    const line = detail!.lines[0];
    expect(line.itemId).toBe(state.itemId);
    expect(line.variantSku).toBe("");
    expect(line.variantLabel).toBeNull();
    expect(line.productName).toBe("Sell-through item");
    expect(line.openingQty).toBe(0);
    expect(line.inQty).toBe(6);
    expect(line.posSoldQty).toBe(3);
    expect(line.gapQty).toBe(2);
    expect(line.closingQty).toBe(1);
    expect(line.countedQty).toBe(1);
    expect(line.billedQty).toBe(3);
    expect(line.shrinkageQty).toBe(0);
    expect(line.negativeSold).toBe(false);
    expect(line.suggestedResolution).toBe("SHRINKAGE");
    expect(line.resolution).toBeNull();
    expect(line.resolutionReason).toBeNull();
    expect(line.unitCost).toBe(10000);
    expect(line.held).toBe(true);

    await resolveSellThroughLine({ lineId: line.id, resolution: "SHRINKAGE", reason: "confirmed theft", userId: state.userId });
    const resolved = await getSellThrough(id);
    const resolvedLine = resolved!.lines[0];
    expect(resolvedLine.resolution).toBe("SHRINKAGE");
    expect(resolvedLine.resolutionReason).toBe("confirmed theft");
    expect(resolvedLine.shrinkageQty).toBe(2);
    expect(resolvedLine.held).toBe(false);

    await fx.approve(id);
    const approved = await getSellThrough(id);
    expect(approved!.status).toBe("APPROVED");
    expect(approved!.approvedById).toBe(state.userId);
    expect(approved!.approvedByLabel).toBe("Test Sell-through User");
    expect(approved!.createdByLabel).toBe("Test Sell-through User");
    expect(approved!.cancelledByLabel).toBeNull();
    expect(approved!.approvedAt).not.toBeNull();
  }, SLOW);

  it("a DRAFT report previews unit prices, line totals and the total from the same pricing rule approve uses", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    /* SHELF_COUNT billing 4 @ margin 20 on sellingPrice 40000 */
    const stocktakeId = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });

    const detail = await getSellThrough(id);
    expect(detail?.lines[0]).toMatchObject({ unitPrice: 50000, lineTotal: 200000 });
    expect(detail?.total).toBe(200000);
    expect(detail?.unpricedKeys).toEqual([]);
    /* the fixture's konsi order salesman is not a candidate */
    expect(detail?.defaultSalesmanId).toBeNull();
  }, SLOW);

  it("an invoiced report returns the stored invoice, receivable and faktur ids", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });

    await fx.approve(id);
    const detail = await getSellThrough(id);
    /* The writer posts no journal — the action does, after commit — so revenue and COGS are both still owed here. */
    expect(detail).toMatchObject({ baseline: false, total: 200000, salesmanId: state.salesmanId, unrelievedCost: null, journalPending: true });
    expect(detail?.receivableId).not.toBeNull();
    expect(detail?.taxInvoiceId).not.toBeNull();
  }, SLOW);

  it("a baseline report shows the cost not relieved from GL inventory and no prices", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });

    await fx.approveBaseline(id);
    const detail = await getSellThrough(id);
    expect(detail).toMatchObject({ baseline: true, total: null, unrelievedCost: 40000, journalPending: false });
    expect(detail?.lines[0].unitPrice).toBeNull();
  }, SLOW);

  it("the list flags a baseline report", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });

    await fx.approveBaseline(id);
    const { items } = await listSellThroughs({ storeId: state.storeId, page: 1, pageSize: 10 });
    expect(items.find((i) => i.id === id)?.baseline).toBe(true);
  }, SLOW);

  it("chains: the second report's previousDocNo names the first report's docNo", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const first = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const r1 = await createSellThrough({ closingStocktakeId: first, createdById: state.userId });
    await fx.approve(r1.id);

    await tick();
    await spgSell(1);
    await tick();
    const second = await count(1);
    const r2 = await createSellThrough({ closingStocktakeId: second, createdById: state.userId });

    const detail = await getSellThrough(r2.id);
    expect(detail!.previousId).toBe(r1.id);
    expect(detail!.previousDocNo).toBe(r1.docNo);
  }, SLOW);

  /* getSellThroughEligibility */

  it("returns NOT_FOUND for a stocktake that does not exist", async () => {
    await expect(getSellThroughEligibility(`missing-${state.run}`)).resolves.toEqual({ eligible: false, reason: "NOT_FOUND" });
  }, SLOW);

  it("returns STOCKTAKE_NOT_APPROVED for a submitted count that was never approved", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const notApproved = await count(6, { approve: false });
    await expect(getSellThroughEligibility(notApproved)).resolves.toEqual({ eligible: false, reason: "STOCKTAKE_NOT_APPROVED" });
  }, SLOW);

  it("returns NOT_FULL_COUNT for an approved count that left a line uncounted", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const partial = await count(null);
    await expect(getSellThroughEligibility(partial)).resolves.toEqual({ eligible: false, reason: "NOT_FULL_COUNT" });
  }, SLOW);

  it("returns NOT_KONSI when the store is no longer a consignment store", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const notKonsiStocktake = await count(6);
    /* Direct flip for the test only — the store edit writer refuses a switch still carrying a method; the form clears it client-side. */
    await prisma.store.update({ where: { id: state.storeId }, data: { termsType: "PUTUS" } });
    await expect(getSellThroughEligibility(notKonsiStocktake)).resolves.toEqual({ eligible: false, reason: "NOT_KONSI" });
  }, SLOW);

  it("returns METHOD_NOT_SET for a KONSI store with no sell-through method, and eligible: true once it is set", async () => {
    await transferIn(6);
    const stocktakeId = await count(6);
    await expect(getSellThroughEligibility(stocktakeId)).resolves.toEqual({ eligible: false, reason: "METHOD_NOT_SET" });

    await setMethod("SHELF_COUNT");
    await expect(getSellThroughEligibility(stocktakeId)).resolves.toEqual({ eligible: true });
  }, SLOW);

  it("returns ALREADY_USED with the existing report's id once a stocktake closes a report", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(6);
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    await expect(getSellThroughEligibility(stocktakeId)).resolves.toEqual({ eligible: false, reason: "ALREADY_USED", existingId: id });
  }, SLOW);

  it("returns OUT_OF_ORDER for a stocktake approved before the previous report's closing stocktake", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const earlier = await count(6);
    await tick();
    const later = await count(6);
    const report = await createSellThrough({ closingStocktakeId: later, createdById: state.userId });
    await fx.approve(report.id);

    await expect(getSellThroughEligibility(earlier)).resolves.toEqual({ eligible: false, reason: "OUT_OF_ORDER" });
  }, SLOW);

  it("returns RETUR_IN_FLIGHT with the unsettled returns' docNos as detail", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const first = await raiseRetur(1);
    const second = await raiseRetur(1);
    await tick();
    const stocktakeId = await count(4, { cause: "SHRINKAGE", reason: "two units off the shelf" });
    await expect(getSellThroughEligibility(stocktakeId)).resolves.toEqual({
      eligible: false,
      reason: "RETUR_IN_FLIGHT",
      detail: `${first.docNo}, ${second.docNo}`,
    });
  }, SLOW);

  it("returns TRANSFER_IN_FLIGHT with the pending transfers' docNos as detail", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(6);
    const { countFinishedAt } = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(stocktakeId) }, select: { countFinishedAt: true } });
    const { docNo } = await fx.storeTransfer({ direction: "OUT", qty: 2, movedAt: new Date(countFinishedAt!.getTime() - 60_000) });
    await expect(getSellThroughEligibility(stocktakeId)).resolves.toEqual({ eligible: false, reason: "TRANSFER_IN_FLIGHT", detail: docNo });
  }, SLOW);

  it("returns DRAFT_EXISTS while an earlier report of the store is still DRAFT", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const first = await count(6);
    await createSellThrough({ closingStocktakeId: first, createdById: state.userId });
    await tick();
    const second = await count(6);
    await expect(getSellThroughEligibility(second)).resolves.toEqual({ eligible: false, reason: "DRAFT_EXISTS" });
  }, SLOW);
});
