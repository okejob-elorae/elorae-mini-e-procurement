import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId, moveStoreStock } from "@elorae/db";
import { createStoreStocktake, saveStocktakeCounts, approveStoreStocktake, cancelStoreStocktake } from "./writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("store stocktake writer (test bed only)", () => {
  const tag = `STKW-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let adminId = "";
  let itemMainId = "";
  let itemNegativeId = "";
  let itemZeroId = "";
  let itemAddedId = "";
  let bogusItemId = "";
  let itemIds: string[] = [];
  let storeId = "";
  let stocktakeIds: string[] = [];
  let stkCounter = 0;

  const docNo = () => `STK/${tag}/${++stkCounter}`;

  type LineSeed = {
    itemId: string;
    variantSku?: string;
    productName?: string;
    expectedQty: number;
    countedQty: number | null;
    reason?: string;
    cause?: "SHRINKAGE" | "UNRECORDED_SALE";
    isAdded?: boolean;
  };

  const mkStocktake = async (opts: { status?: "DRAFT" | "PENDING_VERIFICATION"; openKey?: string | null; lines: LineSeed[] }) => {
    const st = await prisma.storeStocktake.create({
      data: {
        docNo: docNo(),
        storeId,
        status: opts.status ?? "DRAFT",
        openKey: opts.openKey === undefined ? storeId : opts.openKey,
        countedAt: new Date(),
        createdById: adminId,
        lines: {
          create: opts.lines.map((l) => ({
            itemId: l.itemId,
            variantSku: l.variantSku ?? "",
            productName: l.productName ?? "Test line",
            expectedQty: l.expectedQty,
            countedQty: l.countedQty,
            reason: l.reason ?? null,
            cause: l.cause ?? null,
            isAdded: l.isAdded ?? false,
          })),
        },
      },
      select: { id: true },
    });
    stocktakeIds.push(st.id);
    return st.id;
  };

  /**
   * Counts one line through the real save path (which stamps `countFinishedAt`), then moves that
   * stamp a second into the past — test-only — so a movement recorded right after it can never
   * share its millisecond and fall outside the strict `createdAt > countFinishedAt` window.
   */
  const countThroughSave = async (line: LineSeed) => {
    const id = await mkStocktake({ lines: [{ ...line, countedQty: null }] });
    const row = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: seededId(id) }, select: { id: true } });
    await saveStocktakeCounts({
      stocktakeId: id,
      lines: [{ lineId: row.id, countedQty: line.countedQty, cause: line.cause ?? null, reason: line.reason ?? null }],
      submit: true,
      userId: adminId,
    });
    await prisma.storeStocktake.update({ where: { id }, data: { countFinishedAt: new Date(Date.now() - 1000) } });
    return id;
  };

  /* One store movement after the count, through the real delta mover — the same ledger row a POS sale or a konsi delivery writes. */
  const moveAfterCount = (itemId: string, qtyDelta: number, refType: "SpgSale" | "KonsiTransfer") =>
    prisma.$transaction((tx) =>
      moveStoreStock(tx, {
        storeId,
        itemId,
        variantSku: "",
        qtyDelta,
        refType,
        refId: `${tag}-${refType}-${Math.random().toString(36).slice(2, 8)}`,
        refDocNumber: `${refType}/${tag}`,
        createdById: adminId,
      }),
    );

  const stocktakeLedgerRows = (stocktakeId: string, itemId: string) =>
    prisma.stockLedgerEntry.findMany({
      where: { locationType: "STORE", locationId: seededId(storeId), itemId: seededId(itemId), refType: "StoreStocktake", refId: seededId(stocktakeId) },
    });

  beforeEach(async () => {
    uomId = "";
    adminId = "";
    itemMainId = "";
    itemNegativeId = "";
    itemZeroId = "";
    itemAddedId = "";
    bogusItemId = "";
    itemIds = [];
    storeId = "";
    stocktakeIds = [];
    stkCounter = 0;

    const uom = await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } });
    adminId = admin.id;

    const itemMain = await prisma.item.create({ data: { sku: `${tag}-MAIN`, nameId: "Main", nameEn: "Main", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 1000 } });
    itemMainId = itemMain.id;
    const itemNegative = await prisma.item.create({ data: { sku: `${tag}-NEG`, nameId: "Neg", nameEn: "Neg", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 1000 } });
    itemNegativeId = itemNegative.id;
    const itemZero = await prisma.item.create({ data: { sku: `${tag}-ZERO`, nameId: "Zero", nameEn: "Zero", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 1000 } });
    itemZeroId = itemZero.id;
    const itemAdded = await prisma.item.create({ data: { sku: `${tag}-ADD`, nameId: "Added", nameEn: "Added", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 1000 } });
    itemAddedId = itemAdded.id;
    bogusItemId = `${tag}-bogus-item-id`;
    itemIds = [itemMainId, itemNegativeId, itemZeroId, itemAddedId, bogusItemId];

    const store = await prisma.store.create({ data: { code: `${tag}-STORE`, name: "Test Stocktake Writer Store", address: "Jl. Test", termsType: "KONSI", isActive: true } });
    storeId = store.id;

    /*
     * Fresh StoreStock rows every test (beforeEach runs per-test, not per-suite) — itemMain at
     * 10 with a real avgCost, itemNegative already driven negative (the correction-path row),
     * itemZero at zero (the other row this feature exists to make countable). itemAdded
     * deliberately has NO row — an item the store's ledger has never held.
     */
    await prisma.storeStock.create({ data: { storeId, itemId: itemMainId, variantSku: "", qty: 10, avgCost: 12500 } });
    await prisma.storeStock.create({ data: { storeId, itemId: itemNegativeId, variantSku: "", qty: -4, avgCost: 0 } });
    await prisma.storeStock.create({ data: { storeId, itemId: itemZeroId, variantSku: "", qty: 0, avgCost: 8000 } });
  });

  afterEach(async () => {
    await prisma.storeStocktakeLine.deleteMany({ where: { stocktakeId: { in: stocktakeIds } } });
    await prisma.storeStocktake.deleteMany({ where: { id: { in: stocktakeIds } } });
    await prisma.storeStock.deleteMany({ where: { storeId: seededId(storeId), itemId: { in: itemIds } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.item.deleteMany({ where: { id: { in: [seededId(itemMainId), seededId(itemNegativeId), seededId(itemZeroId), seededId(itemAddedId)] } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("writes StoreStock.qty = countedQty for a counted line", async () => {
    const id = await mkStocktake({
      lines: [
        { itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 6, reason: "recount", cause: "SHRINKAGE" },
      ],
    });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(Number(ss.qty)).toBe(6);
  });

  it("writes nothing for a line whose countedQty is null", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: null }],
    });
    /*
     * Moved AFTER the line is built, so the live StoreStock.qty (15) differs from both the
     * line's snapshotted expectedQty (10) and the seeded starting qty (10) — a regression that
     * coerces a null count to `expected` or to the pre-move seed value would still fail this
     * assertion, only a coercion to the CURRENT live qty could slip through undetected, and
     * nothing in the writer ever reads the live qty for an uncounted line.
     */
    await prisma.storeStock.update({ where: { storeId_itemId_variantSku: { storeId, itemId: itemMainId, variantSku: "" } }, data: { qty: 15 } });

    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });

    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(Number(ss.qty)).toBe(15);
    const line = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: seededId(id) } });
    expect(line.appliedQty).toBeNull();
    expect(line.qtyAtApproval).toBeNull();
  });

  it("clears a NEGATIVE row when it is counted at zero — the correction path", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: itemNegativeId, variantSku: "", productName: "Neg", expectedQty: -4, countedQty: 0, reason: "physical count" }],
    });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemNegativeId) } });
    expect(Number(ss.qty)).toBe(0);
  });

  it("includes a ZERO row as a countable line", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: itemZeroId, variantSku: "", productName: "Zero", expectedQty: 0, countedQty: 3, reason: "found stock" }],
    });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemZeroId) } });
    expect(Number(ss.qty)).toBe(3);
  });

  it("creates a StoreStock row at avgCost 0 for an added line with no existing row", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: itemAddedId, variantSku: "", productName: "Added", expectedQty: 0, countedQty: 5, reason: "found on shelf", isAdded: true }],
    });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemAddedId) } });
    expect(Number(ss.qty)).toBe(5);
    expect(Number(ss.avgCost)).toBe(0);
  });

  it("leaves avgCost untouched on both a shortfall and a surplus line", async () => {
    const id = await mkStocktake({
      lines: [
        { itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 6, reason: "recount", cause: "SHRINKAGE" },
        { itemId: itemZeroId, variantSku: "", productName: "Zero", expectedQty: 0, countedQty: 3, reason: "found stock" },
      ],
    });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const main = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    const zero = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemZeroId) } });
    expect(Number(main.avgCost)).toBe(12500);
    expect(Number(zero.avgCost)).toBe(8000);
  });

  it("returns VARIANCE_NEEDS_REASON for a non-zero variance with no reason, and writes nothing", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 6 }],
    });
    await expect(approveStoreStocktake({ stocktakeId: id, approvedById: adminId })).rejects.toMatchObject({ code: "VARIANCE_NEEDS_REASON" });
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(Number(ss.qty)).toBe(10);
  });

  it("returns VARIANCE_NEEDS_REASON for a whitespace-only reason — .trim() rejects it too", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 6, reason: "   ", cause: "SHRINKAGE" }],
    });
    await expect(approveStoreStocktake({ stocktakeId: id, approvedById: adminId })).rejects.toMatchObject({ code: "VARIANCE_NEEDS_REASON" });
  });

  it("returns SHORTFALL_NEEDS_CAUSE for a negative variance with a reason but no cause", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 6, reason: "recount" }],
    });
    await expect(approveStoreStocktake({ stocktakeId: id, approvedById: adminId })).rejects.toMatchObject({ code: "SHORTFALL_NEEDS_CAUSE" });
  });

  it("accepts a positive variance with a reason and no cause", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: itemZeroId, variantSku: "", productName: "Zero", expectedQty: 0, countedQty: 3, reason: "found stock" }],
    });
    const res = await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    expect(res.ok).toBe(true);
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemZeroId) } });
    expect(Number(ss.qty)).toBe(3);
  });

  it("never refuses an unbalanced count — net variance need not cancel to zero", async () => {
    const id = await mkStocktake({
      lines: [
        { itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 6, reason: "recount", cause: "SHRINKAGE" },
        { itemId: itemZeroId, variantSku: "", productName: "Zero", expectedQty: 0, countedQty: 3, reason: "found stock" },
      ],
    });
    const res = await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    expect(res.ok).toBe(true);
    const main = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    const zero = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemZeroId) } });
    expect(Number(main.qty)).toBe(6);
    expect(Number(zero.qty)).toBe(3);
  });

  it("computes varianceQty as counted MINUS expected — a shortfall is negative", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 7, reason: "recount", cause: "SHRINKAGE" }],
    });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const line = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: seededId(id) } });
    expect(Number(line.varianceQty)).toBe(-3);
  });

  it("writes distinct StoreStock rows for the same item's \"\"-keyed and variant-keyed lines, without collapsing them", async () => {
    await prisma.storeStock.create({ data: { storeId, itemId: itemMainId, variantSku: `${tag}-V1`, qty: 20, avgCost: 3000 } });
    const id = await mkStocktake({
      lines: [
        { itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 6, reason: "recount", cause: "SHRINKAGE" },
        { itemId: itemMainId, variantSku: `${tag}-V1`, productName: "Main V1", expectedQty: 20, countedQty: 12, reason: "recount", cause: "SHRINKAGE" },
      ],
    });

    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });

    const plain = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId), variantSku: "" } });
    const variant = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId), variantSku: `${tag}-V1` } });
    expect(Number(plain.qty)).toBe(6);
    expect(Number(variant.qty)).toBe(12);
    const rows = await prisma.storeStock.findMany({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(rows).toHaveLength(2);
  });

  it("stamps qtyAtApproval from the live row and writes the bare counted figure for a count with no countFinishedAt", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 6, reason: "recount", cause: "SHRINKAGE" }],
    });
    // Simulate a konsi transfer landing after the count was taken but before approval.
    await prisma.storeStock.update({ where: { storeId_itemId_variantSku: { storeId, itemId: itemMainId, variantSku: "" } }, data: { qty: 15 } });

    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });

    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(Number(ss.qty)).toBe(6);
    const line = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: seededId(id) } });
    expect(Number(line.qtyAtApproval)).toBe(15);
    expect(Number(line.appliedQty)).toBe(6);
  });

  it("re-applies a POS sale recorded after the count: counted 10, sold 2 after, approves to 8 with no stocktake ledger row", async () => {
    const id = await countThroughSave({ itemId: itemMainId, expectedQty: 10, countedQty: 10 });
    await moveAfterCount(itemMainId, -2, "SpgSale");

    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });

    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(Number(ss.qty)).toBe(8);
    /* Target 10 + (−2) = 8 equals the live row, so setStoreStock short-circuits: the count found nothing lost. */
    expect(await stocktakeLedgerRows(id, itemMainId)).toHaveLength(0);
    const line = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: seededId(id) } });
    expect(Number(line.appliedQty)).toBe(8);
    expect(Number(line.qtyAtApproval)).toBe(8);
    expect(Number(line.varianceQty)).toBe(0);
  });

  it("re-applies a delivery recorded after a short count: counted 6 of 10, 5 delivered after, approves to 11 with a −4 ledger row", async () => {
    const id = await countThroughSave({ itemId: itemMainId, expectedQty: 10, countedQty: 6, cause: "SHRINKAGE", reason: "four missing" });
    await moveAfterCount(itemMainId, 5, "KonsiTransfer");

    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });

    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(Number(ss.qty)).toBe(11);
    const rows = await stocktakeLedgerRows(id, itemMainId);
    expect(rows).toHaveLength(1);
    /* Live 15 → target 6 + 5 = 11: the ledger records the shortfall of 4 at the count moment, not −9. */
    expect(Number(rows[0].qty)).toBe(-4);
    const line = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: seededId(id) } });
    expect(Number(line.appliedQty)).toBe(11);
    expect(Number(line.qtyAtApproval)).toBe(15);
    expect(Number(line.varianceQty)).toBe(-4);
  });

  it("keeps setting the bare counted figure when countFinishedAt is null, even with a movement after the count", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 6, reason: "recount", cause: "SHRINKAGE" }],
    });
    await moveAfterCount(itemMainId, 5, "KonsiTransfer");

    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });

    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(Number(ss.qty)).toBe(6);
    const rows = await stocktakeLedgerRows(id, itemMainId);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].qty)).toBe(-9);
  });

  it("does not re-apply a movement recorded before the count was saved", async () => {
    await moveAfterCount(itemMainId, -3, "SpgSale");
    /* StoreStock is now 7; the counter saw 7 on the shelf, so nothing is lost and nothing moved since. */
    const id = await countThroughSave({ itemId: itemMainId, expectedQty: 10, countedQty: 7, cause: "UNRECORDED_SALE", reason: "sold before the count" });
    await prisma.stockLedgerEntry.updateMany({
      where: { locationType: "STORE", locationId: seededId(storeId), itemId: seededId(itemMainId), refType: "SpgSale" },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });

    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });

    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(Number(ss.qty)).toBe(7);
    expect(await stocktakeLedgerRows(id, itemMainId)).toHaveLength(0);
  });

  it("isFullCount is false when any line is left uncounted", async () => {
    const id = await mkStocktake({
      lines: [
        { itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 6, reason: "recount", cause: "SHRINKAGE" },
        { itemId: itemZeroId, variantSku: "", productName: "Zero", expectedQty: 0, countedQty: null },
      ],
    });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const st = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(id) } });
    expect(st.isFullCount).toBe(false);
  });

  it("isFullCount is true only when every line carried a count", async () => {
    const id = await mkStocktake({
      lines: [
        { itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 6, reason: "recount", cause: "SHRINKAGE" },
        { itemId: itemZeroId, variantSku: "", productName: "Zero", expectedQty: 0, countedQty: 3, reason: "found stock" },
      ],
    });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const st = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(id) } });
    expect(st.isFullCount).toBe(true);
  });

  it("stamps openKey null on approval, and a second stocktake can then be opened for the store", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 10 }],
    });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const st = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(id) } });
    expect(st.openKey).toBeNull();
    expect(st.status).toBe("APPROVED");

    const second = await createStoreStocktake({ storeId, createdById: adminId, countedAt: new Date() });
    stocktakeIds.push(second.id);
    expect(second.docNo).toMatch(/^STK\//);
  });

  it("writes no StockAdjustment and no InventoryValue row", async () => {
    await prisma.inventoryValue.create({ data: { itemId: itemMainId, variantSku: "", qtyOnHand: 100, reservedQty: 0, avgCost: 500, totalValue: 50000 } });
    const adjCountBefore = await prisma.stockAdjustment.count({ where: { itemId: itemMainId } });

    const id = await mkStocktake({
      lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 6, reason: "recount", cause: "SHRINKAGE" }],
    });

    const invBefore = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: itemMainId } });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const invAfter = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: itemMainId } });

    expect(Number(invAfter.qtyOnHand)).toBe(Number(invBefore.qtyOnHand));
    expect(await prisma.stockAdjustment.count({ where: { itemId: itemMainId } })).toBe(adjCountBefore);
  });

  it("returns ITEM_NOT_FOUND for a dangling itemId and writes nothing", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: bogusItemId, variantSku: "", productName: "Ghost", expectedQty: 0, countedQty: 0 }],
    });
    await expect(approveStoreStocktake({ stocktakeId: id, approvedById: adminId })).rejects.toMatchObject({ code: "ITEM_NOT_FOUND" });
    const rows = await prisma.storeStock.findMany({ where: { storeId: seededId(storeId), itemId: seededId(bogusItemId) } });
    expect(rows).toHaveLength(0);
  });

  it("refuses INVALID_STATE when the document is not DRAFT or PENDING_VERIFICATION", async () => {
    const id = await mkStocktake({
      status: "PENDING_VERIFICATION",
      lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 10 }],
    });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    await expect(approveStoreStocktake({ stocktakeId: id, approvedById: adminId })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  describe("createStoreStocktake", () => {
    it("opens a document snapshotting every StoreStock row, with countedQty null on every line", async () => {
      const res = await createStoreStocktake({ storeId, createdById: adminId, countedAt: new Date() });
      stocktakeIds.push(res.id);
      expect(res.docNo).toMatch(/^STK\//);
      const lines = await prisma.storeStocktakeLine.findMany({ where: { stocktakeId: res.id } });
      expect(lines).toHaveLength(3); // itemMain, itemNegative, itemZero
      expect(lines.every((l) => l.countedQty === null)).toBe(true);
    });

    it("refuses ALREADY_OPEN when the store already has an open document", async () => {
      const first = await createStoreStocktake({ storeId, createdById: adminId, countedAt: new Date() });
      stocktakeIds.push(first.id);
      await expect(createStoreStocktake({ storeId, createdById: adminId, countedAt: new Date() })).rejects.toMatchObject({ code: "ALREADY_OPEN" });
    });
  });

  describe("saveStocktakeCounts", () => {
    it("writes countedQty and the computed varianceQty on the targeted line", async () => {
      const id = await mkStocktake({
        lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: null }],
      });
      const line = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: id } });
      const res = await saveStocktakeCounts({ stocktakeId: id, lines: [{ lineId: line.id, countedQty: 6, cause: "SHRINKAGE", reason: "recount" }], submit: false, userId: adminId });
      expect(res.ok).toBe(true);
      expect(res.status).toBe("DRAFT");
      const updated = await prisma.storeStocktakeLine.findUniqueOrThrow({ where: { id: line.id } });
      expect(Number(updated.countedQty)).toBe(6);
      expect(Number(updated.varianceQty)).toBe(-4);
    });

    it("stamps countFinishedAt when a save changes a count, and leaves it alone on a reason-only resave", async () => {
      const id = await mkStocktake({
        lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: null }],
      });
      const line = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: id } });

      await saveStocktakeCounts({ stocktakeId: id, lines: [{ lineId: line.id, countedQty: 6 }], submit: false, userId: adminId });
      const first = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(id) } });
      expect(first.countFinishedAt).not.toBeNull();

      const pinned = new Date(Date.now() - 60_000);
      await prisma.storeStocktake.update({ where: { id }, data: { countFinishedAt: pinned } });

      /* The backoffice resends every line when an admin only fills in a cause and reason. */
      await saveStocktakeCounts({
        stocktakeId: id,
        lines: [{ lineId: line.id, countedQty: 6, cause: "SHRINKAGE", reason: "four missing" }],
        submit: true,
        userId: adminId,
      });
      const reasonOnly = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(id) } });
      expect(reasonOnly.status).toBe("PENDING_VERIFICATION");
      expect(reasonOnly.countFinishedAt?.toISOString()).toBe(pinned.toISOString());

      await saveStocktakeCounts({ stocktakeId: id, lines: [{ lineId: line.id, countedQty: 7, cause: "SHRINKAGE", reason: "recounted" }], submit: false, userId: adminId });
      const recounted = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(id) } });
      expect(recounted.countFinishedAt!.getTime()).toBeGreaterThan(pinned.getTime());
    });

    it("stamps countFinishedAt when a save adds a line", async () => {
      const id = await mkStocktake({ lines: [] });
      await saveStocktakeCounts({
        stocktakeId: id,
        lines: [],
        addedLines: [{ itemId: itemAddedId, variantSku: "", countedQty: 5, reason: "found on shelf" }],
        submit: false,
        userId: adminId,
      });
      const st = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(id) } });
      expect(st.countFinishedAt).not.toBeNull();
    });

    it("moves DRAFT to PENDING_VERIFICATION when submit is true", async () => {
      const id = await mkStocktake({
        lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: null }],
      });
      const line = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: id } });
      const res = await saveStocktakeCounts({ stocktakeId: id, lines: [{ lineId: line.id, countedQty: 6 }], submit: true, userId: adminId });
      expect(res.status).toBe("PENDING_VERIFICATION");
      const st = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(id) } });
      expect(st.status).toBe("PENDING_VERIFICATION");
      expect(st.submittedById).toBe(adminId);
    });

    it("returns INVALID_REQUEST for a lineId that does not belong to the document", async () => {
      const id = await mkStocktake({
        lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: null }],
      });
      await expect(saveStocktakeCounts({ stocktakeId: id, lines: [{ lineId: "not-a-real-line-id", countedQty: 6 }], submit: false, userId: adminId })).rejects.toMatchObject({
        code: "INVALID_REQUEST",
      });
    });

    it("returns INVALID_REQUEST for a negative countedQty", async () => {
      const id = await mkStocktake({
        lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: null }],
      });
      const line = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: id } });
      await expect(saveStocktakeCounts({ stocktakeId: id, lines: [{ lineId: line.id, countedQty: -1 }], submit: false, userId: adminId })).rejects.toMatchObject({
        code: "INVALID_REQUEST",
      });
    });

    it("an added line creates a StoreStock row on approval that did not exist before", async () => {
      const id = await mkStocktake({ lines: [] });
      await saveStocktakeCounts({
        stocktakeId: id,
        lines: [],
        addedLines: [{ itemId: itemAddedId, variantSku: "", countedQty: 5, reason: "found on shelf" }],
        submit: false,
        userId: adminId,
      });
      const before = await prisma.storeStock.findFirst({ where: { storeId: seededId(storeId), itemId: seededId(itemAddedId) } });
      expect(before).toBeNull();

      await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });

      const after = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemAddedId) } });
      expect(Number(after.qty)).toBe(5);
      expect(Number(after.avgCost)).toBe(0);
    });

    it("seeds expectedQty from a live StoreStock row created after the document opened, so a late-landing item shows a shortfall, not a surplus", async () => {
      const id = await mkStocktake({ lines: [] });
      /*
       * Simulate a konsi transfer landing at the store AFTER the document opened (with no
       * StoreStock row for this item at snapshot time) but BEFORE this save — exactly the
       * Monday-open / Tuesday-transfer / Wednesday-count sequence this test guards against.
       */
      await prisma.storeStock.create({ data: { storeId, itemId: itemAddedId, variantSku: "", qty: 100, avgCost: 0 } });

      await saveStocktakeCounts({
        stocktakeId: id,
        lines: [],
        addedLines: [{ itemId: itemAddedId, variantSku: "", countedQty: 90, cause: "SHRINKAGE", reason: "counted 90 on shelf" }],
        submit: false,
        userId: adminId,
      });

      const line = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: id, itemId: itemAddedId } });
      expect(Number(line.expectedQty)).toBe(100);
      expect(Number(line.varianceQty)).toBe(-10);
      expect(line.isAdded).toBe(true);

      const res = await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
      expect(res.ok).toBe(true);
      const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemAddedId) } });
      expect(Number(ss.qty)).toBe(90);
    });

    it("returns ITEM_NOT_FOUND for an added line with a dangling itemId, and writes nothing", async () => {
      const id = await mkStocktake({ lines: [] });
      await expect(
        saveStocktakeCounts({
          stocktakeId: id,
          lines: [],
          addedLines: [{ itemId: bogusItemId, variantSku: "", countedQty: 3, reason: "test" }],
          submit: false,
          userId: adminId,
        }),
      ).rejects.toMatchObject({ code: "ITEM_NOT_FOUND" });

      const lines = await prisma.storeStocktakeLine.findMany({ where: { stocktakeId: id } });
      expect(lines).toHaveLength(0);
    });

    it("returns DUPLICATE_LINE when adding an item already on the document", async () => {
      const id = await mkStocktake({
        lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: null }],
      });
      await expect(
        saveStocktakeCounts({
          stocktakeId: id,
          lines: [],
          addedLines: [{ itemId: itemMainId, variantSku: "", countedQty: 5, reason: "duplicate attempt" }],
          submit: false,
          userId: adminId,
        }),
      ).rejects.toMatchObject({ code: "DUPLICATE_LINE" });
    });

    it("returns DUPLICATE_LINE for two identical added lines within the same batch", async () => {
      const id = await mkStocktake({ lines: [] });
      await expect(
        saveStocktakeCounts({
          stocktakeId: id,
          lines: [],
          addedLines: [
            { itemId: itemAddedId, variantSku: "", countedQty: 5, reason: "found on shelf" },
            { itemId: itemAddedId, variantSku: "", countedQty: 2, reason: "found on shelf again" },
          ],
          submit: false,
          userId: adminId,
        }),
      ).rejects.toMatchObject({ code: "DUPLICATE_LINE" });

      const lines = await prisma.storeStocktakeLine.findMany({ where: { stocktakeId: id } });
      expect(lines).toHaveLength(0);
    });

    it("accepts an added line with a non-zero count and no reason — the reason check is deferred to approval", async () => {
      const id = await mkStocktake({ lines: [] });
      const res = await saveStocktakeCounts({
        stocktakeId: id,
        lines: [],
        addedLines: [{ itemId: itemAddedId, variantSku: "", countedQty: 5 }],
        submit: false,
        userId: adminId,
      });
      expect(res.ok).toBe(true);
      const line = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: id, itemId: itemAddedId } });
      expect(line.isAdded).toBe(true);
      expect(Number(line.varianceQty)).toBe(5);
      expect(line.reason).toBeNull();
    });

    it("approval — not save — rejects an added line's non-zero count with no reason; a reason with no cause is accepted", async () => {
      const id = await mkStocktake({ lines: [] });
      await saveStocktakeCounts({
        stocktakeId: id,
        lines: [],
        addedLines: [{ itemId: itemAddedId, variantSku: "", countedQty: 5 }],
        submit: false,
        userId: adminId,
      });

      await expect(approveStoreStocktake({ stocktakeId: id, approvedById: adminId })).rejects.toMatchObject({ code: "VARIANCE_NEEDS_REASON" });

      const added = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: id, itemId: itemAddedId } });
      await saveStocktakeCounts({
        stocktakeId: id,
        lines: [{ lineId: added.id, countedQty: 5, reason: "found on shelf" }],
        submit: false,
        userId: adminId,
      });

      const res = await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
      expect(res.ok).toBe(true);

      const line = await prisma.storeStocktakeLine.findUniqueOrThrow({ where: { id: added.id } });
      expect(line.isAdded).toBe(true);
      expect(Number(line.varianceQty)).toBe(5);
      expect(line.cause).toBeNull();
    });
  });

  describe("cancelStoreStocktake", () => {
    it("requires a non-empty reason", async () => {
      const id = await mkStocktake({ lines: [] });
      await expect(cancelStoreStocktake({ stocktakeId: id, cancelledById: adminId, reason: "" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    });

    it("nulls openKey and stamps CANCELLED so the store can be counted again", async () => {
      const id = await mkStocktake({ lines: [] });
      await cancelStoreStocktake({ stocktakeId: id, cancelledById: adminId, reason: "abandoned count" });
      const st = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(id) } });
      expect(st.status).toBe("CANCELLED");
      expect(st.openKey).toBeNull();
      expect(st.cancelReason).toBe("abandoned count");

      const second = await createStoreStocktake({ storeId, createdById: adminId, countedAt: new Date() });
      stocktakeIds.push(second.id);
      expect(second.id).toBeTruthy();
    });

    it("refuses INVALID_STATE on an already-APPROVED document", async () => {
      const id = await mkStocktake({
        lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 10 }],
      });
      await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });

      await expect(cancelStoreStocktake({ stocktakeId: id, cancelledById: adminId, reason: "too late" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    });
  });
});
