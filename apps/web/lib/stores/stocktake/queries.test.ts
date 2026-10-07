import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { buildStocktakeLines, getStoreStocktakeById, previousApprovedCountedAt } from "./queries";
import { KONSI_COUNT_SYSTEM_ACTOR } from "@/lib/konsi-count-schedule/schedule";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("store stocktake queries (test bed only)", () => {
  const tag = `STK-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let userId = "";
  let itemAId = "";
  let itemBId = "";
  let itemCId = "";
  let storeId = "";
  let freshStoreId = "";
  let quietStoreId = "";
  let stocktakeIds: string[] = [];
  let spgSaleIds: string[] = [];
  let storeStockIds: string[] = [];
  let assortmentLineIds: string[] = [];

  beforeEach(async () => {
    uomId = "";
    userId = "";
    itemAId = "";
    itemBId = "";
    itemCId = "";
    storeId = "";
    freshStoreId = "";
    quietStoreId = "";
    stocktakeIds = [];
    spgSaleIds = [];
    storeStockIds = [];
    assortmentLineIds = [];

    const uom = await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const user = await prisma.user.create({ data: { email: `${tag}@example.com`.toLowerCase(), name: "Test Stocktake User" } });
    userId = user.id;

    const itemA = await prisma.item.create({
      data: { sku: `${tag}-A`, nameId: "Test Stocktake Item A", nameEn: "Item A", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 1000 },
    });
    itemAId = itemA.id;
    const itemB = await prisma.item.create({
      data: { sku: `${tag}-B`, nameId: "Test Stocktake Item B", nameEn: "Item B", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 1000 },
    });
    itemBId = itemB.id;
    const itemC = await prisma.item.create({
      data: { sku: `${tag}-C`, nameId: "Test Stocktake Item C", nameEn: "Item C", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 1000 },
    });
    itemCId = itemC.id;

    const store = await prisma.store.create({
      data: { code: `${tag}-STORE`, name: "Test Stocktake Store", address: "Jl. Test", termsType: "KONSI", isActive: true },
    });
    storeId = store.id;
    const fresh = await prisma.store.create({
      data: { code: `${tag}-FRESH`, name: "Test Stocktake Fresh Store", address: "Jl. Test", termsType: "KONSI", isActive: true },
    });
    freshStoreId = fresh.id;
    const quiet = await prisma.store.create({
      data: { code: `${tag}-QUIET`, name: "Test Stocktake Quiet Store", address: "Jl. Test", termsType: "KONSI", isActive: true },
    });
    quietStoreId = quiet.id;
  });

  afterEach(async () => {
    await prisma.fieldReturnLine.deleteMany({ where: { returnDoc: { storeId: seededId(storeId) } } });
    await prisma.fieldReturn.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.storeStocktakeLine.deleteMany({ where: { stocktakeId: { in: stocktakeIds.map(seededId) } } });
    await prisma.storeStocktake.deleteMany({ where: { id: { in: stocktakeIds.map(seededId) } } });
    await prisma.spgSaleLine.deleteMany({ where: { spgSaleId: { in: spgSaleIds.map(seededId) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: spgSaleIds.map(seededId) } } });
    await prisma.storeStock.deleteMany({ where: { id: { in: storeStockIds.map(seededId) } } });
    await prisma.storeAssortmentLine.deleteMany({ where: { id: { in: assortmentLineIds.map(seededId) } } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(storeId), seededId(freshStoreId), seededId(quietStoreId)] } } });
    await prisma.item.deleteMany({ where: { id: { in: [seededId(itemAId), seededId(itemBId), seededId(itemCId)] } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("builds a line from EVERY StoreStock row including zero and negative", async () => {
    const rowHigh = await prisma.storeStock.create({ data: { storeId, itemId: itemAId, variantSku: "", qty: 10, avgCost: 0 } });
    const rowZero = await prisma.storeStock.create({ data: { storeId, itemId: itemBId, variantSku: "", qty: 0, avgCost: 0 } });
    const rowNegative = await prisma.storeStock.create({ data: { storeId, itemId: itemCId, variantSku: "", qty: -2, avgCost: 0 } });
    storeStockIds.push(rowHigh.id, rowZero.id, rowNegative.id);

    const lines = await buildStocktakeLines(prisma, seededId(storeId), null, new Date());

    expect(lines).toHaveLength(3);
    expect(
      lines.map((l) => l.expectedQty).sort((a, b) => a - b),
    ).toEqual([-2, 0, 10]);
  });

  it("takes periodFrom from the previous APPROVED stocktake's countedAt", async () => {
    const stocktake = await prisma.storeStocktake.create({
      data: {
        docNo: `STK/${tag}/1`,
        storeId,
        status: "APPROVED",
        countedAt: new Date("2026-08-01T00:00:00.000Z"),
        createdById: userId,
      },
    });
    stocktakeIds.push(stocktake.id);

    const from = await previousApprovedCountedAt(prisma, seededId(storeId));

    expect(from?.toISOString().slice(0, 10)).toBe("2026-08-01");
  });

  it("ignores a CANCELLED stocktake when choosing periodFrom", async () => {
    const approved = await prisma.storeStocktake.create({
      data: {
        docNo: `STK/${tag}/2`,
        storeId,
        status: "APPROVED",
        countedAt: new Date("2026-08-01T00:00:00.000Z"),
        createdById: userId,
      },
    });
    const cancelled = await prisma.storeStocktake.create({
      data: {
        docNo: `STK/${tag}/3`,
        storeId,
        status: "CANCELLED",
        countedAt: new Date("2026-08-20T00:00:00.000Z"),
        createdById: userId,
      },
    });
    stocktakeIds.push(approved.id, cancelled.id);

    const from = await previousApprovedCountedAt(prisma, seededId(storeId));

    expect(from?.toISOString().slice(0, 10)).toBe("2026-08-01");
  });

  it("returns null periodFrom for a store's first stocktake", async () => {
    const from = await previousApprovedCountedAt(prisma, seededId(freshStoreId));

    expect(from).toBeNull();
  });

  it("sums SpgSale units inside the window only, per item and variant", async () => {
    const windowFrom = new Date("2026-08-10T00:00:00.000Z");
    const windowTo = new Date("2026-08-20T00:00:00.000Z");

    const stockRow = await prisma.storeStock.create({ data: { storeId, itemId: itemAId, variantSku: "", qty: 20, avgCost: 0 } });
    storeStockIds.push(stockRow.id);

    const before = await prisma.spgSale.create({
      data: {
        docNo: `SPGSALE/${tag}/BEFORE`,
        salesmanId: userId,
        storeId,
        createdById: userId,
        subtotal: 0,
        total: 0,
        cashReceived: 0,
        changeGiven: 0,
        createdAt: new Date("2026-08-05T00:00:00.000Z"),
        lines: { create: [{ itemId: itemAId, variantSku: "", productName: "Test Stocktake Item A", qty: 5, unitPrice: 0, lineTotal: 0 }] },
      },
    });
    const inside = await prisma.spgSale.create({
      data: {
        docNo: `SPGSALE/${tag}/INSIDE`,
        salesmanId: userId,
        storeId,
        createdById: userId,
        subtotal: 0,
        total: 0,
        cashReceived: 0,
        changeGiven: 0,
        createdAt: new Date("2026-08-15T00:00:00.000Z"),
        lines: { create: [{ itemId: itemAId, variantSku: "", productName: "Test Stocktake Item A", qty: 3, unitPrice: 0, lineTotal: 0 }] },
      },
    });
    const after = await prisma.spgSale.create({
      data: {
        docNo: `SPGSALE/${tag}/AFTER`,
        salesmanId: userId,
        storeId,
        createdById: userId,
        subtotal: 0,
        total: 0,
        cashReceived: 0,
        changeGiven: 0,
        createdAt: new Date("2026-08-25T00:00:00.000Z"),
        lines: { create: [{ itemId: itemAId, variantSku: "", productName: "Test Stocktake Item A", qty: 2, unitPrice: 0, lineTotal: 0 }] },
      },
    });
    spgSaleIds.push(before.id, inside.id, after.id);

    const lines = await buildStocktakeLines(prisma, seededId(storeId), windowFrom, windowTo);
    const line = lines.find((l) => l.itemId === itemAId && l.variantSku === "")!;

    expect(line.soldInPeriodQty).toBe(3);
  });

  it("reports zero sold rather than omitting the line when the window holds no sales", async () => {
    const stockRow = await prisma.storeStock.create({ data: { storeId: quietStoreId, itemId: itemAId, variantSku: "", qty: 5, avgCost: 0 } });
    storeStockIds.push(stockRow.id);

    const lines = await buildStocktakeLines(prisma, seededId(quietStoreId), null, new Date());

    expect(lines).toHaveLength(1);
    expect(lines[0].soldInPeriodQty).toBe(0);
  });

  it("prefills an assortment SKU with no StoreStock row as an expectedQty 0 line", async () => {
    const assortmentLine = await prisma.storeAssortmentLine.create({
      data: { storeId: freshStoreId, itemId: itemAId, variantSku: "", createdById: userId },
    });
    assortmentLineIds.push(assortmentLine.id);

    const lines = await buildStocktakeLines(prisma, seededId(freshStoreId), null, new Date());

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      itemId: itemAId,
      variantSku: "",
      productName: "Test Stocktake Item A",
      expectedQty: 0,
      soldInPeriodQty: 0,
    });
  });

  it("does not mark a prefilled assortment line isAdded", async () => {
    const assortmentLine = await prisma.storeAssortmentLine.create({
      data: { storeId: freshStoreId, itemId: itemAId, variantSku: "", createdById: userId },
    });
    assortmentLineIds.push(assortmentLine.id);

    const lines = await buildStocktakeLines(prisma, seededId(freshStoreId), null, new Date());
    const line = lines.find((l) => l.itemId === itemAId && l.variantSku === "")!;

    expect("isAdded" in line).toBe(false);
  });

  it("produces exactly ONE line for a SKU that is both stocked and on the assortment", async () => {
    const stockRow = await prisma.storeStock.create({ data: { storeId, itemId: itemBId, variantSku: "", qty: 7, avgCost: 0 } });
    storeStockIds.push(stockRow.id);
    const assortmentLine = await prisma.storeAssortmentLine.create({
      data: { storeId, itemId: itemBId, variantSku: "", createdById: userId },
    });
    assortmentLineIds.push(assortmentLine.id);

    const lines = await buildStocktakeLines(prisma, seededId(storeId), null, new Date());
    const matching = lines.filter((l) => l.itemId === seededId(itemBId) && l.variantSku === "");

    expect(matching).toHaveLength(1);
    expect(matching[0].expectedQty).toBe(7);
  });

  it("still returns every StoreStock row when the store has no assortment at all", async () => {
    const rowA = await prisma.storeStock.create({ data: { storeId: quietStoreId, itemId: itemAId, variantSku: "", qty: 4, avgCost: 0 } });
    const rowB = await prisma.storeStock.create({ data: { storeId: quietStoreId, itemId: itemBId, variantSku: "", qty: 9, avgCost: 0 } });
    storeStockIds.push(rowA.id, rowB.id);

    const lines = await buildStocktakeLines(prisma, seededId(quietStoreId), null, new Date());

    expect(lines).toHaveLength(2);
    expect(
      lines.map((l) => l.expectedQty).sort((a, b) => a - b),
    ).toEqual([4, 9]);
  });

  it("flags the count-schedule system actor as the creator instead of resolving it as a user", async () => {
    const system = await prisma.storeStocktake.create({
      data: { docNo: `STK/${tag}/sys`, storeId, status: "DRAFT", countedAt: new Date(), createdById: KONSI_COUNT_SYSTEM_ACTOR },
    });
    const human = await prisma.storeStocktake.create({
      data: { docNo: `STK/${tag}/usr`, storeId, status: "DRAFT", countedAt: new Date(), createdById: userId },
    });
    stocktakeIds.push(system.id, human.id);

    const bySystem = await getStoreStocktakeById(system.id);
    expect(bySystem?.createdByIsSystem).toBe(true);
    expect(bySystem?.createdByLabel).toBe("—");

    const byUser = await getStoreStocktakeById(human.id);
    expect(byUser?.createdByIsSystem).toBe(false);
    expect(byUser?.createdByLabel).toBe("Test Stocktake User");
  });

  /* returInFlight — the advisory naming returs in flight at the count moment */

  const countMoment = new Date(Date.now() - 10 * 60_000);
  const before = new Date(countMoment.getTime() - 60 * 60_000);
  const after = new Date(countMoment.getTime() + 60_000);

  const mkRetur = (
    n: number,
    opts: { status: "PENDING_WAREHOUSE_RECEIVING" | "APPROVED" | "CANCELLED"; createdAt: Date; approvedAt?: Date },
    lines: Array<{ itemId: string; variantSku: string; qty: number }>,
  ) =>
    prisma.fieldReturn.create({
      data: {
        docNo: `FRET/${tag}/${n}`,
        storeId,
        raisedById: userId,
        status: opts.status,
        createdAt: opts.createdAt,
        approvedAt: opts.approvedAt ?? null,
        lines: { create: lines.map((l) => ({ ...l, reason: "UNSOLD" as const })) },
      },
      select: { docNo: true },
    });

  const mkCountedStocktake = async (countFinishedAt: Date | null) => {
    const st = await prisma.storeStocktake.create({
      data: {
        docNo: `STK/${tag}/rif-${stocktakeIds.length}`,
        storeId,
        status: "PENDING_VERIFICATION",
        countedAt: countMoment,
        countFinishedAt,
        createdById: userId,
        lines: {
          create: [
            { itemId: itemAId, variantSku: "", productName: "A", expectedQty: 10, countedQty: 6 },
            { itemId: itemBId, variantSku: "", productName: "B", expectedQty: 5, countedQty: 5 },
            { itemId: itemCId, variantSku: "RED-S", productName: "C", expectedQty: 4, countedQty: 3 },
          ],
        },
      },
      select: { id: true, lines: { select: { id: true, itemId: true } } },
    });
    stocktakeIds.push(st.id);
    const lineIdOf = (itemId: string) => st.lines.find((l) => l.itemId === itemId)!.id;
    return { id: st.id, lineA: lineIdOf(itemAId), lineC: lineIdOf(itemCId) };
  };

  it("sums the returs in flight at the count moment onto the lines they match, and leaves the figures alone", async () => {
    const { id, lineA, lineC } = await mkCountedStocktake(countMoment);
    /* Open, raised before the count: in flight. Its variant spelling differs only in case from the line's. */
    const open = await mkRetur(1, { status: "PENDING_WAREHOUSE_RECEIVING", createdAt: before }, [
      { itemId: itemAId, variantSku: "", qty: 2 },
      { itemId: itemCId, variantSku: "red-s", qty: 1 },
    ]);
    /* Approved only after the count: still in flight at the count moment. */
    const lateApproved = await mkRetur(2, { status: "APPROVED", createdAt: before, approvedAt: after }, [{ itemId: itemAId, variantSku: "", qty: 1 }]);
    /* Settled before the count, cancelled, and raised after the count: none of them in flight. */
    await mkRetur(3, { status: "APPROVED", createdAt: before, approvedAt: new Date(countMoment.getTime() - 60_000) }, [{ itemId: itemAId, variantSku: "", qty: 5 }]);
    await mkRetur(4, { status: "CANCELLED", createdAt: before }, [{ itemId: itemAId, variantSku: "", qty: 5 }]);
    await mkRetur(5, { status: "PENDING_WAREHOUSE_RECEIVING", createdAt: after }, [{ itemId: itemBId, variantSku: "", qty: 5 }]);

    const detail = await getStoreStocktakeById(id);

    expect(detail?.returInFlight).toEqual({ docNos: [open.docNo, lateApproved.docNo], qtyByLineId: { [lineA]: 3, [lineC]: 1 } });
    const a = detail?.lines.find((l) => l.id === lineA);
    expect(a?.expectedQty).toBe(10);
    expect(a?.countedQty).toBe(6);
  });

  it("returns an empty advisory at a PUTUS store, where a retur never moves StoreStock", async () => {
    await prisma.store.update({ where: { id: storeId }, data: { termsType: "PUTUS" } });
    const { id } = await mkCountedStocktake(countMoment);
    await mkRetur(1, { status: "PENDING_WAREHOUSE_RECEIVING", createdAt: before }, [{ itemId: itemAId, variantSku: "", qty: 2 }]);

    const detail = await getStoreStocktakeById(id);

    expect(detail?.returInFlight).toEqual({ docNos: [], qtyByLineId: {} });
  });

  it("returns an empty advisory for a count with neither countFinishedAt nor approvedAt", async () => {
    const { id } = await mkCountedStocktake(null);
    await mkRetur(1, { status: "PENDING_WAREHOUSE_RECEIVING", createdAt: before }, [{ itemId: itemAId, variantSku: "", qty: 2 }]);

    const detail = await getStoreStocktakeById(id);

    expect(detail?.returInFlight).toEqual({ docNos: [], qtyByLineId: {} });
  });
});
