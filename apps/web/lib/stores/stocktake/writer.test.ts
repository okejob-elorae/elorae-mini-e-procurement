import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId, moveStoreStock } from "@elorae/db";
import { createStoreStocktake, saveStocktakeCounts, approveStoreStocktake, cancelStoreStocktake } from "./writer";
import { createFieldReturn } from "@/lib/field-sales/retur/writer";
import { createStoreTransfer, approveStoreTransfer } from "@/lib/stores/transfer/writer";

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
  let storeBId = "";
  let stocktakeIds: string[] = [];
  let konsiOrderIds: string[] = [];
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

  const mkStocktake = async (opts: { status?: "DRAFT" | "PENDING_VERIFICATION"; openKey?: string | null; storeId?: string; lines: LineSeed[] }) => {
    const target = opts.storeId ?? storeId;
    const st = await prisma.storeStocktake.create({
      data: {
        docNo: docNo(),
        storeId: target,
        status: opts.status ?? "DRAFT",
        openKey: opts.openKey === undefined ? target : opts.openKey,
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

  /* Moves the document's and every stamped line's `countFinishedAt` `ms` into the past, test-only. */
  const backdateCountStamps = async (stocktakeId: string, ms: number) => {
    const at = new Date(Date.now() - ms);
    await prisma.storeStocktake.update({ where: { id: stocktakeId }, data: { countFinishedAt: at } });
    await prisma.storeStocktakeLine.updateMany({ where: { stocktakeId: seededId(stocktakeId), countFinishedAt: { not: null } }, data: { countFinishedAt: at } });
    return at;
  };

  /**
   * Counts one line through the real save path (which stamps `countFinishedAt` on the document and
   * on the line), then moves both stamps a second into the past — test-only — so a movement
   * recorded right after it can never share its millisecond and fall outside the strict
   * `createdAt > countFinishedAt` window. Approval reads the line's own stamp, so backdating only
   * the document's would leave the line at the save instant.
   */
  const countThroughSave = async (line: LineSeed, target: string = storeId) => {
    const id = await mkStocktake({ storeId: target, lines: [{ ...line, countedQty: null }] });
    const row = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: seededId(id) }, select: { id: true } });
    await saveStocktakeCounts({
      stocktakeId: id,
      lines: [{ lineId: row.id, countedQty: line.countedQty, cause: line.cause ?? null, reason: line.reason ?? null }],
      submit: true,
      userId: adminId,
    });
    await backdateCountStamps(id, 1000);
    return id;
  };

  /* One store movement after the count, through the real delta mover — the same ledger row a POS sale or a konsi delivery writes. */
  const moveAfterCount = (itemId: string, qtyDelta: number, refType: "SpgSale" | "KonsiTransfer" | "FieldReturn", refId?: string) =>
    prisma.$transaction((tx) =>
      moveStoreStock(tx, {
        storeId,
        itemId,
        variantSku: "",
        qtyDelta,
        refType,
        refId: refId ?? `${tag}-${refType}-${Math.random().toString(36).slice(2, 8)}`,
        refDocNumber: `${refType}/${tag}`,
        createdById: adminId,
      }),
    );

  /* A FIELD retur raised at the store (itemMain unless told otherwise) — only the document; the test writes its store ledger rows itself. */
  const raiseRetur = async (qty: number, returItemIds: string[] = [itemMainId]) => {
    const { returnId } = await createFieldReturn({
      storeId,
      raisedById: adminId,
      origin: "FIELD",
      transport: "SELF_CARRY",
      notaPhotoUrl: "https://r2.example/nota.jpg",
      notaPhotoR2Key: `field-return-notas/${tag}/nota.jpg`,
      lines: returItemIds.map((itemId) => ({ itemId, variantSku: "", qty, reason: "UNSOLD" as const })),
    });
    return returnId;
  };

  const stocktakeLedgerRows = (stocktakeId: string, itemId: string, target: string = storeId) =>
    prisma.stockLedgerEntry.findMany({
      where: { locationType: "STORE", locationId: seededId(target), itemId: seededId(itemId), refType: "StoreStocktake", refId: seededId(stocktakeId) },
    });

  /**
   * Five itemMain delivered to the store on a konsi order, in the offline-completion shape: the
   * shipment carries the device's `deliveredAt`, while the transfer's +5 store row lands now, at
   * sync. A null `deliveredAt` issues a legacy transfer with no shipment at all.
   */
  const deliverKonsi = async (deliveredAt: Date | null) => {
    const n = ++stkCounter;
    const order = await prisma.fieldSalesOrder.create({
      data: { orderNo: `KONSI/${tag}/${n}`, storeId, salesmanId: adminId, status: "APPROVED", orderType: "KONSI", subtotal: 0, total: 0 },
      select: { id: true },
    });
    konsiOrderIds.push(order.id);
    const shipment = deliveredAt
      ? await prisma.deliveryShipment.create({
        data: { docNo: `DLV/${tag}/${n}`, orderId: order.id, method: "EXPEDITION", status: "DELIVERED", packedById: adminId, deliveredAt, deliveredById: adminId },
        select: { id: true },
      })
      : null;
    const transfer = await prisma.konsiTransfer.create({
      data: { docNo: `KONSITRF/${tag}/${n}`, orderId: order.id, storeId, transferredById: adminId, shipmentId: shipment?.id ?? null },
      select: { id: true },
    });
    await moveAfterCount(itemMainId, 5, "KonsiTransfer", transfer.id);
  };

  /* A PENDING_VERIFICATION count of one itemMain line, its document and line both stamped at `countedAt`, test-only. */
  const countAt = async (countedAt: Date, line: LineSeed) => {
    const id = await mkStocktake({ status: "PENDING_VERIFICATION", lines: [line] });
    await prisma.storeStocktake.update({ where: { id }, data: { countFinishedAt: countedAt } });
    await prisma.storeStocktakeLine.updateMany({ where: { stocktakeId: seededId(id) }, data: { countFinishedAt: countedAt } });
    return id;
  };

  /* Three units of itemMain moved between the two stores through the real transfer writer, left PENDING. */
  const recordTransfer = (fromStoreId: string, toStoreId: string, movedAt: Date) =>
    createStoreTransfer({ fromStoreId, toStoreId, movedAt, createdById: adminId, lines: [{ itemId: itemMainId, variantSku: "", qty: 3 }] });

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
    storeBId = "";
    stocktakeIds = [];
    konsiOrderIds = [];
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
    const storeB = await prisma.store.create({ data: { code: `${tag}-STORE-B`, name: "Test Stocktake Writer Store B", address: "Jl. Test", termsType: "KONSI", isActive: true } });
    storeBId = storeB.id;

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
    /* The transfer before its shipment (an optional 1:1 under relationMode = "prisma"), both before the order and the store. */
    await prisma.konsiTransfer.deleteMany({ where: { orderId: { in: konsiOrderIds } } });
    await prisma.deliveryShipment.deleteMany({ where: { orderId: { in: konsiOrderIds } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: konsiOrderIds } } });
    const bothStores = [seededId(storeId), seededId(storeBId)];
    const transferWhere = { OR: [{ fromStoreId: { in: bothStores } }, { toStoreId: { in: bothStores } }] };
    await prisma.storeTransferLine.deleteMany({ where: { transfer: transferWhere } });
    await prisma.storeTransfer.deleteMany({ where: transferWhere });
    await prisma.fieldReturnLine.deleteMany({ where: { returnDoc: { storeId: seededId(storeId) } } });
    await prisma.fieldReturn.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.storeStocktakeLine.deleteMany({ where: { stocktakeId: { in: stocktakeIds } } });
    await prisma.storeStocktake.deleteMany({ where: { id: { in: stocktakeIds } } });
    await prisma.storeStock.deleteMany({ where: { storeId: { in: bothStores }, itemId: { in: itemIds } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.store.deleteMany({ where: { id: { in: bothStores } } });
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

  it("does not re-apply the store row of a retur raised before the count: counted 8 after 2 left on a retur, approves to 8", async () => {
    /* The salesman takes 2 at raise time; StoreStock stays 10 until the retur settles. Raised well before the count, test-only. */
    const returnId = await raiseRetur(2);
    await prisma.fieldReturn.update({ where: { id: returnId }, data: { createdAt: new Date(Date.now() - 60_000) } });
    const id = await countThroughSave({ itemId: itemMainId, expectedQty: 10, countedQty: 8, cause: "SHRINKAGE", reason: "two units on a retur" });
    /* The retur settles after the count: its store row lands now, −2 → StoreStock 8. */
    await moveAfterCount(itemMainId, -2, "FieldReturn", returnId);

    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });

    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    /* Not 8 − 2 = 6: the count already saw those two units gone. */
    expect(Number(ss.qty)).toBe(8);
    expect(await stocktakeLedgerRows(id, itemMainId)).toHaveLength(0);
    const line = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: seededId(id) } });
    expect(Number(line.appliedQty)).toBe(8);
  });

  it("still re-applies the store row of a retur raised after the count", async () => {
    const id = await countThroughSave({ itemId: itemMainId, expectedQty: 10, countedQty: 10 });
    /* Raised after the count was saved, so its goods left a shelf the count had already seen full. */
    const returnId = await raiseRetur(2);
    await moveAfterCount(itemMainId, -2, "FieldReturn", returnId);

    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });

    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(Number(ss.qty)).toBe(8);
    expect(await stocktakeLedgerRows(id, itemMainId)).toHaveLength(0);
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

  it("refuses TRANSFER_PENDING while a transfer out of the store, moved before the count, is still pending, and writes nothing", async () => {
    const { docNo } = await recordTransfer(storeId, storeBId, new Date(Date.now() - 120_000));
    const id = await countThroughSave({ itemId: itemMainId, expectedQty: 10, countedQty: 7, cause: "SHRINKAGE", reason: "three moved to store B" });

    await expect(approveStoreStocktake({ stocktakeId: id, approvedById: adminId })).rejects.toMatchObject({ code: "TRANSFER_PENDING", detail: docNo });

    const st = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(id) } });
    expect(st.status).toBe("PENDING_VERIFICATION");
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(Number(ss.qty)).toBe(10);
  });

  it("refuses TRANSFER_PENDING for a pending transfer INTO the store as well", async () => {
    const { docNo } = await recordTransfer(storeBId, storeId, new Date(Date.now() - 120_000));
    const id = await countThroughSave({ itemId: itemMainId, expectedQty: 10, countedQty: 13, reason: "three arrived from store B" });
    await expect(approveStoreStocktake({ stocktakeId: id, approvedById: adminId })).rejects.toMatchObject({ code: "TRANSFER_PENDING", detail: docNo });
  });

  it("does not refuse over a pending transfer whose goods moved moments after the count", async () => {
    const id = await countThroughSave({ itemId: itemMainId, expectedQty: 10, countedQty: 10 });
    /* countFinishedAt is a second ago and the move is now: compared as instants, the move is after the count. */
    await recordTransfer(storeId, storeBId, new Date());
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(Number(ss.qty)).toBe(10);
  });

  it("does not refuse TRANSFER_PENDING over a pending transfer of an item this count never counted", async () => {
    /* The transfer moves itemMain; this partial count only counted itemZero, so it never saw the move. */
    await recordTransfer(storeId, storeBId, new Date(Date.now() - 120_000));
    const id = await countThroughSave({ itemId: itemZeroId, expectedQty: 0, countedQty: 0 });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const st = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(id) } });
    expect(st.status).toBe("APPROVED");
  });

  it("does not refuse TRANSFER_PENDING when the transferred item's line was left uncounted", async () => {
    /* The count lists itemMain but left it blank and counted itemZero only, so it never saw the move. */
    await recordTransfer(storeId, storeBId, new Date(Date.now() - 120_000));
    const id = await mkStocktake({
      status: "PENDING_VERIFICATION",
      lines: [
        { itemId: itemMainId, expectedQty: 10, countedQty: null },
        { itemId: itemZeroId, expectedQty: 0, countedQty: 0 },
      ],
    });
    await prisma.storeStocktake.update({ where: { id }, data: { countFinishedAt: new Date(Date.now() - 1000) } });

    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });

    const st = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(id) } });
    expect(st.status).toBe("APPROVED");
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId), variantSku: "" } });
    expect(Number(ss.qty)).toBe(10);
  });

  it("does not refuse TRANSFER_PENDING when the count counted another variant of the transferred item", async () => {
    /* The transfer moves itemMain's variantless key; this count counted itemMain under "RED" only. */
    await recordTransfer(storeId, storeBId, new Date(Date.now() - 120_000));
    const id = await countThroughSave({ itemId: itemMainId, variantSku: "RED", expectedQty: 0, countedQty: 0 });

    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });

    const st = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(id) } });
    expect(st.status).toBe("APPROVED");
  });

  it("refuses TRANSFER_PENDING for a count saved before countFinishedAt existed, falling back to the approval instant as the count moment", async () => {
    /*
     * No countFinishedAt on this document (created directly, never through saveStocktakeCounts),
     * so the only count moment available is this approval's own instant — matching the fallback
     * `approveStoreTransfer`'s own COUNTED_SINCE_MOVE guard already uses for the same case, so the
     * two guards never disagree about whether this count saw the move.
     */
    const { docNo } = await recordTransfer(storeId, storeBId, new Date(Date.now() - 120_000));
    const id = await mkStocktake({
      lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 7, reason: "recount", cause: "SHRINKAGE" }],
    });

    await expect(approveStoreStocktake({ stocktakeId: id, approvedById: adminId })).rejects.toMatchObject({ code: "TRANSFER_PENDING", detail: docNo });

    const st = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(id) } });
    expect(st.status).toBe("DRAFT");
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(Number(ss.qty)).toBe(10);
  });

  it("keeps setting the bare counted figure for a null-countFinishedAt count once the pending transfer is out of the way", async () => {
    /*
     * Same shape as the refusal case above, but the transfer is cancelled first — the pending
     * check has nothing left to refuse, and the null-countFinishedAt re-application behaviour
     * (bare counted figure, no post-count exclusion) is unchanged by this fix.
     */
    const { transferId } = await recordTransfer(storeId, storeBId, new Date(Date.now() - 120_000));
    await prisma.storeTransfer.update({ where: { id: transferId }, data: { status: "CANCELLED" } });
    const id = await mkStocktake({
      lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 7, reason: "recount", cause: "SHRINKAGE" }],
    });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(Number(ss.qty)).toBe(7);
  });

  it("does not re-apply either leg of a transfer moved before the count and approved after it: both stores end at their counted figures", async () => {
    /* The goods left A for B two minutes ago; both shelves were counted after that, and the transfer is recorded as approved only now. */
    const { transferId } = await recordTransfer(storeId, storeBId, new Date(Date.now() - 120_000));
    const idA = await countThroughSave({ itemId: itemMainId, expectedQty: 10, countedQty: 7, cause: "SHRINKAGE", reason: "three moved to store B" });
    const idB = await countThroughSave({ itemId: itemMainId, expectedQty: 0, countedQty: 3, reason: "three arrived from store A" }, storeBId);
    await approveStoreTransfer({ transferId, approvedById: adminId });

    await approveStoreStocktake({ stocktakeId: idA, approvedById: adminId });
    await approveStoreStocktake({ stocktakeId: idB, approvedById: adminId });

    const ssA = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    const ssB = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeBId), itemId: seededId(itemMainId) } });
    /* Not 7 − 3 = 4 and 3 + 3 = 6: each count already saw the move. */
    expect(Number(ssA.qty)).toBe(7);
    expect(Number(ssB.qty)).toBe(3);
    expect(await stocktakeLedgerRows(idA, itemMainId)).toHaveLength(0);
    expect(await stocktakeLedgerRows(idB, itemMainId, storeBId)).toHaveLength(0);
    const lineA = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: seededId(idA) } });
    expect(Number(lineA.appliedQty)).toBe(7);
  });

  it("still re-applies a transfer whose goods moved moments after the count", async () => {
    const id = await countThroughSave({ itemId: itemMainId, expectedQty: 10, countedQty: 10 });
    const { transferId } = await recordTransfer(storeId, storeBId, new Date());
    await approveStoreTransfer({ transferId, approvedById: adminId });

    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });

    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(Number(ss.qty)).toBe(7);
    expect(await stocktakeLedgerRows(id, itemMainId)).toHaveLength(0);
  });

  it("keeps each line's own count moment when an admin edits another line", async () => {
    const id = await mkStocktake({
      lines: [
        { itemId: itemZeroId, expectedQty: 0, countedQty: null },
        { itemId: itemMainId, expectedQty: 10, countedQty: null },
      ],
    });
    const lineA = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: seededId(id), itemId: seededId(itemZeroId) } });
    const lineB = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: seededId(id), itemId: seededId(itemMainId) } });
    await saveStocktakeCounts({
      stocktakeId: id,
      lines: [
        { lineId: lineA.id, countedQty: 0 },
        { lineId: lineB.id, countedQty: 10 },
      ],
      submit: true,
      userId: adminId,
    });
    const countedAt = await backdateCountStamps(id, 2000);

    /* Two of B sell after its shelf was counted. */
    await moveAfterCount(itemMainId, -2, "SpgSale");

    /* The admin corrects A only; the backoffice resends every line, B at the same figure. */
    await saveStocktakeCounts({
      stocktakeId: id,
      lines: [
        { lineId: lineA.id, countedQty: 1, reason: "one found behind the counter" },
        { lineId: lineB.id, countedQty: 10 },
      ],
      submit: true,
      userId: adminId,
    });
    const a = await prisma.storeStocktakeLine.findUniqueOrThrow({ where: { id: lineA.id } });
    const b = await prisma.storeStocktakeLine.findUniqueOrThrow({ where: { id: lineB.id } });
    expect(b.countFinishedAt?.toISOString()).toBe(countedAt.toISOString());
    expect(a.countFinishedAt!.getTime()).toBeGreaterThan(countedAt.getTime());

    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });

    /* B: counted 10 at its own moment, −2 sold since → 8. Keyed on the document's last save, the sale would be erased and B set back to 10. */
    const ssB = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(Number(ssB.qty)).toBe(8);
    expect(await stocktakeLedgerRows(id, itemMainId)).toHaveLength(0);
    const ssA = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemZeroId) } });
    expect(Number(ssA.qty)).toBe(1);
    const approvedB = await prisma.storeStocktakeLine.findUniqueOrThrow({ where: { id: lineB.id } });
    expect(Number(approvedB.appliedQty)).toBe(8);
  });

  it("a line saved before the column existed falls back to the document stamp", async () => {
    const id = await countThroughSave({ itemId: itemMainId, expectedQty: 10, countedQty: 10 });
    await prisma.storeStocktakeLine.updateMany({ where: { stocktakeId: seededId(id) }, data: { countFinishedAt: null } });
    await moveAfterCount(itemMainId, -2, "SpgSale");

    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });

    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(Number(ss.qty)).toBe(8);
    expect(await stocktakeLedgerRows(id, itemMainId)).toHaveLength(0);
  });

  it("a retur raised between two lines' moments is excluded only for the line counted after it", async () => {
    /*
     * itemMain's shelf (10) is counted first; then a retur takes 2 of itemMain and 2 of itemZero;
     * then itemZero's shelf (5 − 2 = 3) is counted. The retur settles after both, landing its
     * store rows now. All three instants are pinned test-only.
     */
    await prisma.storeStock.update({ where: { storeId_itemId_variantSku: { storeId, itemId: itemZeroId, variantSku: "" } }, data: { qty: 5 } });
    const mainCountedAt = new Date(Date.now() - 60_000);
    const returRaisedAt = new Date(Date.now() - 30_000);
    const zeroCountedAt = new Date(Date.now() - 10_000);

    const returnId = await raiseRetur(2, [itemMainId, itemZeroId]);
    await prisma.fieldReturn.update({ where: { id: returnId }, data: { createdAt: returRaisedAt } });
    const id = await mkStocktake({
      status: "PENDING_VERIFICATION",
      lines: [
        { itemId: itemMainId, expectedQty: 10, countedQty: 10 },
        { itemId: itemZeroId, expectedQty: 5, countedQty: 3, cause: "SHRINKAGE", reason: "two units on a retur" },
      ],
    });
    await prisma.storeStocktake.update({ where: { id }, data: { countFinishedAt: zeroCountedAt } });
    await prisma.storeStocktakeLine.updateMany({ where: { stocktakeId: seededId(id), itemId: seededId(itemMainId) }, data: { countFinishedAt: mainCountedAt } });
    await prisma.storeStocktakeLine.updateMany({ where: { stocktakeId: seededId(id), itemId: seededId(itemZeroId) }, data: { countFinishedAt: zeroCountedAt } });

    await moveAfterCount(itemMainId, -2, "FieldReturn", returnId);
    await moveAfterCount(itemZeroId, -2, "FieldReturn", returnId);

    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });

    /* itemMain was counted before the raise, so the retur's −2 is re-applied: 10 − 2 = 8, not a +2 phantom at 10. */
    const ssMain = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(Number(ssMain.qty)).toBe(8);
    expect(await stocktakeLedgerRows(id, itemMainId)).toHaveLength(0);
    /* itemZero was counted after the raise and already saw the two gone: 3, not 3 − 2 = 1. */
    const ssZero = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemZeroId) } });
    expect(Number(ssZero.qty)).toBe(3);
    expect(await stocktakeLedgerRows(id, itemZeroId)).toHaveLength(0);
  });

  it("does not re-apply a konsi delivery whose shipment was delivered before the line was counted, though its row synced after", async () => {
    /* Delivered 60 minutes ago, shelf counted 30 minutes ago holding all 15, completion synced now. */
    const deliveredAt = new Date(Date.now() - 60 * 60_000);
    const id = await countAt(new Date(Date.now() - 30 * 60_000), { itemId: itemMainId, expectedQty: 10, countedQty: 15, reason: "five delivered" });
    await deliverKonsi(deliveredAt);

    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });

    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    /* Not 15 + 5 = 20: the shelf already held the delivered five. */
    expect(Number(ss.qty)).toBe(15);
    expect(await stocktakeLedgerRows(id, itemMainId)).toHaveLength(0);
    const line = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: seededId(id) } });
    expect(Number(line.appliedQty)).toBe(15);
  });

  it("re-applies a konsi delivery whose shipment was delivered after the line was counted", async () => {
    /* Shelf counted 90 minutes ago at 10, delivered 60 minutes ago, completion synced now. */
    const deliveredAt = new Date(Date.now() - 60 * 60_000);
    const id = await countAt(new Date(Date.now() - 90 * 60_000), { itemId: itemMainId, expectedQty: 10, countedQty: 10 });
    await deliverKonsi(deliveredAt);

    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });

    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(Number(ss.qty)).toBe(15);
    expect(await stocktakeLedgerRows(id, itemMainId)).toHaveLength(0);
    const line = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: seededId(id) } });
    expect(Number(line.appliedQty)).toBe(15);
  });

  it("always re-applies a legacy konsi transfer with no shipment", async () => {
    const id = await countAt(new Date(Date.now() - 30 * 60_000), { itemId: itemMainId, expectedQty: 10, countedQty: 10 });
    await deliverKonsi(null);

    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });

    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(Number(ss.qty)).toBe(15);
    expect(await stocktakeLedgerRows(id, itemMainId)).toHaveLength(0);
  });

  describe("SPG sheet device times", () => {
    it("re-applies a sale made after the shelf was counted but before the sheet was saved", async () => {
      const id = await mkStocktake({ lines: [{ itemId: itemMainId, expectedQty: 10, countedQty: null }] });
      const line = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: seededId(id) }, select: { id: true } });
      /* The shelf held 10 when counted a minute ago; one sold since, before the sheet was submitted. */
      const countedAtMs = Date.now() - 60_000;
      await moveAfterCount(itemMainId, -1, "SpgSale");

      const sentAtMs = Date.now();
      await saveStocktakeCounts({
        stocktakeId: id,
        lines: [{ lineId: line.id, countedQty: 10, countedAtMs }],
        submit: true,
        userId: adminId,
        clientClock: { sentAtMs, receivedAtMs: sentAtMs },
      });
      const stamped = await prisma.storeStocktakeLine.findUniqueOrThrow({ where: { id: line.id } });
      /* No skew between the device and the server here, so the moment is the device time itself. */
      expect(stamped.countFinishedAt?.getTime()).toBe(countedAtMs);
      /* The document keeps the save instant: every document-level guard reads it, never device time. */
      const doc = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(id) } });
      expect(doc.countFinishedAt!.getTime()).toBeGreaterThanOrEqual(sentAtMs);

      await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });

      /* 10 − 1 = 9, the live figure: no surplus of one at the count moment. */
      const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
      expect(Number(ss.qty)).toBe(9);
      expect(await stocktakeLedgerRows(id, itemMainId)).toHaveLength(0);
    });

    it("clamps a countedAtMs older than the store's previous approval to that approval", async () => {
      const previousId = await mkStocktake({ lines: [{ itemId: itemMainId, expectedQty: 10, countedQty: 10 }] });
      await approveStoreStocktake({ stocktakeId: previousId, approvedById: adminId });
      const previousApprovedAt = new Date(Date.now() - 30_000);
      await prisma.storeStocktake.update({ where: { id: previousId }, data: { approvedAt: previousApprovedAt } });

      const id = await mkStocktake({ lines: [{ itemId: itemMainId, expectedQty: 10, countedQty: null }] });
      const line = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: seededId(id) }, select: { id: true } });
      const sentAtMs = Date.now();
      await saveStocktakeCounts({
        stocktakeId: id,
        lines: [{ lineId: line.id, countedQty: 10, countedAtMs: sentAtMs - 120_000 }],
        submit: true,
        userId: adminId,
        clientClock: { sentAtMs, receivedAtMs: sentAtMs },
      });

      const stamped = await prisma.storeStocktakeLine.findUniqueOrThrow({ where: { id: line.id } });
      expect(stamped.countFinishedAt?.getTime()).toBe(previousApprovedAt.getTime());
    });

    it("never re-applies an earlier count's own ledger row to a line clamped to that count's approval", async () => {
      /* The earlier count found 6 of 10: its approval wrote a −4 StoreStocktake row, stamped just after its approvedAt. */
      const previousId = await mkStocktake({ lines: [{ itemId: itemMainId, expectedQty: 10, countedQty: 6, cause: "SHRINKAGE", reason: "four missing" }] });
      await approveStoreStocktake({ stocktakeId: previousId, approvedById: adminId });
      const previousApprovedAt = new Date(Date.now() - 30_000);
      await prisma.storeStocktake.update({ where: { id: previousId }, data: { approvedAt: previousApprovedAt } });
      await prisma.stockLedgerEntry.updateMany({
        where: { locationType: "STORE", locationId: seededId(storeId), refType: "StoreStocktake", refId: seededId(previousId) },
        data: { createdAt: new Date(previousApprovedAt.getTime() + 5) },
      });

      const id = await mkStocktake({ lines: [{ itemId: itemMainId, expectedQty: 6, countedQty: null }] });
      const line = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: seededId(id) }, select: { id: true } });
      const sentAtMs = Date.now();
      await saveStocktakeCounts({
        stocktakeId: id,
        lines: [{ lineId: line.id, countedQty: 6, countedAtMs: sentAtMs - 120_000 }],
        submit: true,
        userId: adminId,
        clientClock: { sentAtMs, receivedAtMs: sentAtMs },
      });

      await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });

      /* 6, not 6 − 4 = 2: the earlier count's correction is not a movement this shelf missed. */
      const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
      expect(Number(ss.qty)).toBe(6);
      expect(await stocktakeLedgerRows(id, itemMainId)).toHaveLength(0);
    });

    it("ignores device times on a save that sends no clientClock", async () => {
      const id = await mkStocktake({ lines: [{ itemId: itemMainId, expectedQty: 10, countedQty: null }] });
      const line = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: seededId(id) }, select: { id: true } });
      const before = Date.now();
      await saveStocktakeCounts({
        stocktakeId: id,
        lines: [{ lineId: line.id, countedQty: 10, countedAtMs: before - 60_000 }],
        submit: false,
        userId: adminId,
      });
      const stamped = await prisma.storeStocktakeLine.findUniqueOrThrow({ where: { id: line.id } });
      expect(stamped.countFinishedAt!.getTime()).toBeGreaterThanOrEqual(before);
    });
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

    it("stores the caller's note, and leaves it null when none is given", async () => {
      const withNote = await createStoreStocktake({ storeId, createdById: adminId, countedAt: new Date(), note: "Dibuka otomatis untuk perhitungan bulanan September 2026" });
      stocktakeIds.push(withNote.id);
      const noted = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(withNote.id) } });
      expect(noted.note).toBe("Dibuka otomatis untuk perhitungan bulanan September 2026");

      await cancelStoreStocktake({ stocktakeId: withNote.id, cancelledById: adminId, reason: "reopen without a note" });
      const without = await createStoreStocktake({ storeId, createdById: adminId, countedAt: new Date() });
      stocktakeIds.push(without.id);
      const plain = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(without.id) } });
      expect(plain.note).toBeNull();
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
      const firstLine = await prisma.storeStocktakeLine.findUniqueOrThrow({ where: { id: line.id } });
      expect(firstLine.countFinishedAt?.toISOString()).toBe(first.countFinishedAt!.toISOString());

      const pinned = await backdateCountStamps(id, 60_000);

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
      const reasonOnlyLine = await prisma.storeStocktakeLine.findUniqueOrThrow({ where: { id: line.id } });
      expect(reasonOnlyLine.countFinishedAt?.toISOString()).toBe(pinned.toISOString());

      await saveStocktakeCounts({ stocktakeId: id, lines: [{ lineId: line.id, countedQty: 7, cause: "SHRINKAGE", reason: "recounted" }], submit: false, userId: adminId });
      const recounted = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(id) } });
      expect(recounted.countFinishedAt!.getTime()).toBeGreaterThan(pinned.getTime());
      const recountedLine = await prisma.storeStocktakeLine.findUniqueOrThrow({ where: { id: line.id } });
      expect(recountedLine.countFinishedAt?.toISOString()).toBe(recounted.countFinishedAt!.toISOString());

      /* Clearing a count clears its line stamp: an uncounted line has no count moment. */
      await saveStocktakeCounts({ stocktakeId: id, lines: [{ lineId: line.id, countedQty: null }], submit: false, userId: adminId });
      const cleared = await prisma.storeStocktakeLine.findUniqueOrThrow({ where: { id: line.id } });
      expect(cleared.countFinishedAt).toBeNull();
    });

    it("a reason-only resave touches no line stamp", async () => {
      const id = await mkStocktake({
        lines: [
          { itemId: itemMainId, expectedQty: 10, countedQty: null },
          { itemId: itemZeroId, expectedQty: 0, countedQty: null },
        ],
      });
      const lines = await prisma.storeStocktakeLine.findMany({ where: { stocktakeId: seededId(id) }, orderBy: { id: "asc" } });
      await saveStocktakeCounts({ stocktakeId: id, lines: lines.map((l) => ({ lineId: l.id, countedQty: 4 })), submit: false, userId: adminId });
      const pinned = await backdateCountStamps(id, 60_000);

      await saveStocktakeCounts({
        stocktakeId: id,
        lines: lines.map((l) => ({ lineId: l.id, countedQty: 4, cause: "SHRINKAGE" as const, reason: "verified" })),
        submit: true,
        userId: adminId,
      });

      const after = await prisma.storeStocktakeLine.findMany({ where: { stocktakeId: seededId(id) }, orderBy: { id: "asc" } });
      expect(after.map((l) => l.countFinishedAt?.toISOString())).toEqual([pinned.toISOString(), pinned.toISOString()]);
      expect(after.every((l) => l.reason === "verified")).toBe(true);
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
      const added = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: seededId(id), itemId: seededId(itemAddedId) } });
      expect(added.countFinishedAt?.toISOString()).toBe(st.countFinishedAt!.toISOString());
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
