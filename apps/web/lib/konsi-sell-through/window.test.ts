import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { stocktakeBoundary, loadSellThroughInputs } from "./window";

/* Stock-mutating (seeds ledger rows directly) — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("konsi sell-through window (test bed only)", () => {
  describe("stocktakeBoundary", () => {
    const token = Math.random().toString(36).slice(2, 10);
    let uomId = "";
    let userId = "";
    let storeId = "";
    let itemId = "";
    let stRowsId = "";
    let stNoRowsId = "";
    let rowAId = "";
    let rowBId = "";

    beforeEach(async () => {
      uomId = "";
      userId = "";
      storeId = "";
      itemId = "";
      stRowsId = "";
      stNoRowsId = "";
      rowAId = "";
      rowBId = "";

      const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-KSB-${token}`, nameId: "pcs", nameEn: "pcs" } });
      uomId = uom.id;
      const user = await prisma.user.create({ data: { email: `test-ksb-${token}@example.com`, name: "Test Admin" } });
      userId = user.id;
      const store = await prisma.store.create({
        data: { code: `TEST-KSB-STORE-${token}`, name: "Test Konsi Store", address: "Test address", termsType: "KONSI", marginPercent: 20, isActive: true },
      });
      storeId = store.id;
      const item = await prisma.item.create({
        data: { sku: `TEST-KSB-ITEM-${token}`, nameId: "Item", nameEn: "Item", type: "FINISHED_GOOD", uomId, isActive: true },
      });
      itemId = item.id;

      const stRows = await prisma.storeStocktake.create({
        data: {
          docNo: `SST/TEST-KSB-ROWS/${token}`,
          storeId,
          status: "APPROVED",
          countedAt: new Date("2026-03-01T00:00:00.000Z"),
          approvedAt: new Date("2026-02-01T00:00:00.000Z"),
          approvedById: userId,
          createdById: userId,
          isFullCount: true,
        },
      });
      stRowsId = stRows.id;

      /**
       * Two own ledger rows at different times — boundary must be the LATER one, not the first
       * written and not the stocktake's approvedAt (which is deliberately set earlier than both,
       * so a wrong implementation clamping to approvedAt would be caught).
       */
      const rowA = await prisma.stockLedgerEntry.create({
        data: {
          locationType: "STORE",
          locationId: storeId,
          itemId,
          variantSku: "",
          type: "OUT",
          qty: -2,
          balanceQty: 8,
          refType: "StoreStocktake",
          refId: stRowsId,
          refDocNumber: stRows.docNo,
          createdAt: new Date("2026-03-01T00:00:00.000Z"),
        },
      });
      rowAId = rowA.id;
      const rowB = await prisma.stockLedgerEntry.create({
        data: {
          locationType: "STORE",
          locationId: storeId,
          itemId,
          variantSku: "",
          type: "OUT",
          qty: -1,
          balanceQty: 7,
          refType: "StoreStocktake",
          refId: stRowsId,
          refDocNumber: stRows.docNo,
          createdAt: new Date("2026-03-01T00:05:00.000Z"),
        },
      });
      rowBId = rowB.id;

      const stNoRows = await prisma.storeStocktake.create({
        data: {
          docNo: `SST/TEST-KSB-NOROWS/${token}`,
          storeId,
          status: "APPROVED",
          countedAt: new Date("2026-03-02T00:00:00.000Z"),
          approvedAt: new Date("2026-03-02T00:00:00.000Z"),
          approvedById: userId,
          createdById: userId,
          isFullCount: true,
        },
      });
      stNoRowsId = stNoRows.id;
    });

    afterEach(async () => {
      await prisma.stockLedgerEntry.deleteMany({ where: { id: { in: [seededId(rowAId), seededId(rowBId)] } } });
      await prisma.storeStocktake.deleteMany({ where: { id: { in: [seededId(stRowsId), seededId(stNoRowsId)] } } });
      await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
      await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
      await prisma.user.deleteMany({ where: { id: seededId(userId) } });
      await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    });

    it("is the max createdAt of the stocktake's own ledger rows, not its approvedAt", async () => {
      const boundary = await prisma.$transaction((tx) => stocktakeBoundary(tx, storeId, stRowsId));
      expect(boundary.toISOString()).toBe("2026-03-01T00:05:00.000Z");
    });

    it("falls back to approvedAt when the stocktake wrote no ledger rows", async () => {
      const boundary = await prisma.$transaction((tx) => stocktakeBoundary(tx, storeId, stNoRowsId));
      expect(boundary.toISOString()).toBe("2026-03-02T00:00:00.000Z");
    });
  });

  describe("loadSellThroughInputs — first report (no previous)", () => {
    const token = Math.random().toString(36).slice(2, 10);
    let uomId = "";
    let userId = "";
    let storeId = "";
    let otherStoreId = "";
    let itemAId = "";
    let itemBId = "";
    let stocktakeId = "";
    let rBeforeId = "";
    let rOwn1Id = "";
    let rOwn2Id = "";
    let rAtId = "";
    let rAfterId = "";
    let rOtherStoreId = "";

    const T_BEFORE = new Date("2026-04-01T00:00:00.000Z");
    const T_OWN1 = new Date("2026-04-01T00:10:00.000Z");
    const T_OWN2 = new Date("2026-04-01T00:20:00.000Z");
    const T_AFTER = new Date(T_OWN2.getTime() + 1);

    beforeEach(async () => {
      uomId = "";
      userId = "";
      storeId = "";
      otherStoreId = "";
      itemAId = "";
      itemBId = "";
      stocktakeId = "";
      rBeforeId = "";
      rOwn1Id = "";
      rOwn2Id = "";
      rAtId = "";
      rAfterId = "";
      rOtherStoreId = "";

      const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-KSW1-${token}`, nameId: "pcs", nameEn: "pcs" } });
      uomId = uom.id;
      const user = await prisma.user.create({ data: { email: `test-ksw1-${token}@example.com`, name: "Test Admin" } });
      userId = user.id;
      const store = await prisma.store.create({
        data: { code: `TEST-KSW1-STORE-${token}`, name: "Test Konsi Store", address: "Test address", termsType: "KONSI", marginPercent: 20, isActive: true },
      });
      storeId = store.id;
      const otherStore = await prisma.store.create({
        data: { code: `TEST-KSW1-OTHER-${token}`, name: "Other Konsi Store", address: "Test address", termsType: "KONSI", marginPercent: 20, isActive: true },
      });
      otherStoreId = otherStore.id;
      const itemA = await prisma.item.create({
        data: { sku: `TEST-KSW1-A-${token}`, nameId: "Item A", nameEn: "Item A", type: "FINISHED_GOOD", uomId, isActive: true },
      });
      itemAId = itemA.id;
      const itemB = await prisma.item.create({
        data: { sku: `TEST-KSW1-B-${token}`, nameId: "Item B", nameEn: "Item B", type: "FINISHED_GOOD", uomId, isActive: true },
      });
      itemBId = itemB.id;

      const stocktake = await prisma.storeStocktake.create({
        data: {
          docNo: `SST/TEST-KSW1/${token}`,
          storeId,
          status: "APPROVED",
          countedAt: T_OWN1,
          approvedAt: T_OWN1,
          approvedById: userId,
          createdById: userId,
          isFullCount: true,
        },
      });
      stocktakeId = stocktake.id;

      await prisma.storeStocktakeLine.create({
        data: {
          stocktakeId,
          itemId: itemAId,
          variantSku: "",
          productName: "Item A",
          expectedQty: 8,
          countedQty: 7,
          appliedQty: 7,
          qtyAtApproval: 8,
          isAdded: false,
        },
      });
      await prisma.storeStocktakeLine.create({
        data: {
          stocktakeId,
          itemId: itemBId,
          variantSku: "",
          productName: "Item B",
          expectedQty: 3,
          countedQty: 3,
          cause: "SHRINKAGE",
          reason: "counted short",
          appliedQty: 3,
          qtyAtApproval: 3,
          isAdded: false,
        },
      });

      const rBefore = await prisma.stockLedgerEntry.create({
        data: {
          locationType: "STORE",
          locationId: storeId,
          itemId: itemAId,
          variantSku: "",
          type: "IN",
          qty: 10,
          balanceQty: 10,
          refType: "KonsiTransfer",
          refId: `TEST-KSW1-KTF-${token}`,
          refDocNumber: `KONSITRF/TEST-KSW1/${token}`,
          createdAt: T_BEFORE,
        },
      });
      rBeforeId = rBefore.id;

      const rOwn1 = await prisma.stockLedgerEntry.create({
        data: {
          locationType: "STORE",
          locationId: storeId,
          itemId: itemAId,
          variantSku: "",
          type: "OUT",
          qty: -2,
          balanceQty: 8,
          refType: "StoreStocktake",
          refId: stocktakeId,
          refDocNumber: stocktake.docNo,
          createdAt: T_OWN1,
        },
      });
      rOwn1Id = rOwn1.id;

      const rOwn2 = await prisma.stockLedgerEntry.create({
        data: {
          locationType: "STORE",
          locationId: storeId,
          itemId: itemAId,
          variantSku: "",
          type: "OUT",
          qty: -1,
          balanceQty: 7,
          refType: "StoreStocktake",
          refId: stocktakeId,
          refDocNumber: stocktake.docNo,
          createdAt: T_OWN2,
        },
      });
      rOwn2Id = rOwn2.id;

      /**
       * Exactly at the boundary (same instant as the stocktake's own latest row) — must be
       * included, the inclusive edge of the window.
       */
      const rAt = await prisma.stockLedgerEntry.create({
        data: {
          locationType: "STORE",
          locationId: storeId,
          itemId: itemAId,
          variantSku: "",
          type: "OUT",
          qty: -1,
          balanceQty: 6,
          refType: "SpgSale",
          refId: `TEST-KSW1-SPG-AT-${token}`,
          refDocNumber: `SPGSALE/TEST-KSW1-AT/${token}`,
          createdAt: T_OWN2,
        },
      });
      rAtId = rAt.id;

      /* 1ms after the boundary — must be excluded. */
      const rAfter = await prisma.stockLedgerEntry.create({
        data: {
          locationType: "STORE",
          locationId: storeId,
          itemId: itemAId,
          variantSku: "",
          type: "OUT",
          qty: -5,
          balanceQty: 1,
          refType: "SpgSale",
          refId: `TEST-KSW1-SPG-AFTER-${token}`,
          refDocNumber: `SPGSALE/TEST-KSW1-AFTER/${token}`,
          createdAt: T_AFTER,
        },
      });
      rAfterId = rAfter.id;

      /* Same time range, a DIFFERENT store — must never be returned. */
      const rOtherStore = await prisma.stockLedgerEntry.create({
        data: {
          locationType: "STORE",
          locationId: otherStoreId,
          itemId: itemAId,
          variantSku: "",
          type: "IN",
          qty: 99,
          balanceQty: 99,
          refType: "KonsiTransfer",
          refId: `TEST-KSW1-KTF-OTHER-${token}`,
          refDocNumber: `KONSITRF-OTHER/TEST-KSW1/${token}`,
          createdAt: T_BEFORE,
        },
      });
      rOtherStoreId = rOtherStore.id;
    });

    afterEach(async () => {
      await prisma.stockLedgerEntry.deleteMany({
        where: { id: { in: [seededId(rBeforeId), seededId(rOwn1Id), seededId(rOwn2Id), seededId(rAtId), seededId(rAfterId), seededId(rOtherStoreId)] } },
      });
      await prisma.storeStocktakeLine.deleteMany({ where: { stocktakeId: seededId(stocktakeId) } });
      await prisma.storeStocktake.deleteMany({ where: { id: seededId(stocktakeId) } });
      await prisma.item.deleteMany({ where: { id: { in: [seededId(itemAId), seededId(itemBId)] } } });
      await prisma.store.deleteMany({ where: { id: { in: [seededId(storeId), seededId(otherStoreId)] } } });
      await prisma.user.deleteMany({ where: { id: seededId(userId) } });
      await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    });

    it("returns rows up to and including the boundary, excludes one 1ms after, and excludes another store", async () => {
      const result = await prisma.$transaction((tx) => loadSellThroughInputs(tx, { storeId, closingStocktakeId: stocktakeId, previous: null }));
      const refIds = result.rows.map((r) => r.refId);
      expect(refIds).toContain(`TEST-KSW1-KTF-${token}`);
      expect(refIds).toContain(`TEST-KSW1-SPG-AT-${token}`);
      expect(refIds.filter((id) => id === stocktakeId)).toHaveLength(2);
      expect(refIds).not.toContain(`TEST-KSW1-SPG-AFTER-${token}`);
      expect(refIds).not.toContain(`TEST-KSW1-KTF-OTHER-${token}`);
      expect(result.rows).toHaveLength(4);
    });

    it("orders rows by createdAt ascending", async () => {
      const result = await prisma.$transaction((tx) => loadSellThroughInputs(tx, { storeId, closingStocktakeId: stocktakeId, previous: null }));
      const beforeIndex = result.rows.findIndex((r) => r.refId === `TEST-KSW1-KTF-${token}`);
      const ownIndexes = result.rows.map((r, i) => (r.refId === stocktakeId ? i : -1)).filter((i) => i >= 0);
      expect(beforeIndex).toBeLessThan(Math.min(...ownIndexes));
    });

    it("has no periodStart and periodEnd equal to the boundary, for the first report", async () => {
      const result = await prisma.$transaction((tx) => loadSellThroughInputs(tx, { storeId, closingStocktakeId: stocktakeId, previous: null }));
      expect(result.periodStart).toBeNull();
      expect(result.periodEnd.toISOString()).toBe(T_OWN2.toISOString());
    });

    it("has no openings for the first report", async () => {
      const result = await prisma.$transaction((tx) => loadSellThroughInputs(tx, { storeId, closingStocktakeId: stocktakeId, previous: null }));
      expect(result.openings).toEqual([]);
    });

    it("reads the closing stocktake's own counted lines, including cause", async () => {
      const result = await prisma.$transaction((tx) => loadSellThroughInputs(tx, { storeId, closingStocktakeId: stocktakeId, previous: null }));
      const a = result.counted.find((c) => c.itemId === itemAId);
      const b = result.counted.find((c) => c.itemId === itemBId);
      expect(a).toEqual({ itemId: itemAId, variantSku: "", countedQty: 7, cause: null });
      expect(b).toEqual({ itemId: itemBId, variantSku: "", countedQty: 3, cause: "SHRINKAGE" });
    });
  });

  describe("loadSellThroughInputs — chained report (with previous)", () => {
    const token = Math.random().toString(36).slice(2, 10);
    let uomId = "";
    let userId = "";
    let storeId = "";
    let itemId = "";
    let prevStocktakeId = "";
    let prevReportId = "";
    let prevLineId = "";
    let curStocktakeId = "";
    let p1Id = "";
    let p2Id = "";
    let lowerEdgeAtId = "";
    let lowerEdgeAfterId = "";
    let midId = "";
    let c1Id = "";
    let c2Id = "";

    const T_P1 = new Date("2026-05-01T00:00:00.000Z");
    const T_P2 = new Date("2026-05-01T00:10:00.000Z");
    const T_MID = new Date("2026-05-01T00:20:00.000Z");
    const T_C1 = new Date("2026-05-01T00:30:00.000Z");
    const T_C2 = new Date("2026-05-01T00:40:00.000Z");

    beforeEach(async () => {
      uomId = "";
      userId = "";
      storeId = "";
      itemId = "";
      prevStocktakeId = "";
      prevReportId = "";
      prevLineId = "";
      curStocktakeId = "";
      p1Id = "";
      p2Id = "";
      lowerEdgeAtId = "";
      lowerEdgeAfterId = "";
      midId = "";
      c1Id = "";
      c2Id = "";

      const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-KSW2-${token}`, nameId: "pcs", nameEn: "pcs" } });
      uomId = uom.id;
      const user = await prisma.user.create({ data: { email: `test-ksw2-${token}@example.com`, name: "Test Admin" } });
      userId = user.id;
      const store = await prisma.store.create({
        data: { code: `TEST-KSW2-STORE-${token}`, name: "Test Konsi Store", address: "Test address", termsType: "KONSI", marginPercent: 20, isActive: true },
      });
      storeId = store.id;
      const item = await prisma.item.create({
        data: { sku: `TEST-KSW2-ITEM-${token}`, nameId: "Item C", nameEn: "Item C", type: "FINISHED_GOOD", uomId, isActive: true },
      });
      itemId = item.id;

      const prevStocktake = await prisma.storeStocktake.create({
        data: {
          docNo: `SST/TEST-KSW2-PREV/${token}`,
          storeId,
          status: "APPROVED",
          countedAt: T_P1,
          approvedAt: T_P1,
          approvedById: userId,
          createdById: userId,
          isFullCount: true,
        },
      });
      prevStocktakeId = prevStocktake.id;

      /**
       * Two own rows for the PREVIOUS stocktake — the later one (p2) is what correctly defines
       * the previous boundary. Both must be excluded from the CURRENT report's window regardless
       * of which one a wrong implementation might mistake for "the" boundary.
       */
      const p1 = await prisma.stockLedgerEntry.create({
        data: {
          locationType: "STORE",
          locationId: storeId,
          itemId,
          variantSku: "",
          type: "OUT",
          qty: -2,
          balanceQty: 8,
          refType: "StoreStocktake",
          refId: prevStocktakeId,
          refDocNumber: prevStocktake.docNo,
          createdAt: T_P1,
        },
      });
      p1Id = p1.id;
      const p2 = await prisma.stockLedgerEntry.create({
        data: {
          locationType: "STORE",
          locationId: storeId,
          itemId,
          variantSku: "",
          type: "OUT",
          qty: -1,
          balanceQty: 7,
          refType: "StoreStocktake",
          refId: prevStocktakeId,
          refDocNumber: prevStocktake.docNo,
          createdAt: T_P2,
        },
      });
      p2Id = p2.id;

      /**
       * Pins the window's LOWER edge as EXCLUSIVE. A row at exactly the previous boundary (T_P2)
       * is an ordinary movement, not a StoreStocktake row for either stocktake — if the lower
       * bound were `gte` instead of `gt`, it would leak into BOTH this report's window and the
       * previous one's, double-counting it. Its sibling 1ms later must be included.
       */
      const lowerEdgeAt = await prisma.stockLedgerEntry.create({
        data: {
          locationType: "STORE",
          locationId: storeId,
          itemId,
          variantSku: "",
          type: "OUT",
          qty: -4,
          balanceQty: 3,
          refType: "SpgSale",
          refId: `TEST-KSW2-SPG-LOWER-AT-${token}`,
          refDocNumber: `SPGSALE/TEST-KSW2-LOWER-AT/${token}`,
          createdAt: T_P2,
        },
      });
      lowerEdgeAtId = lowerEdgeAt.id;
      const lowerEdgeAfter = await prisma.stockLedgerEntry.create({
        data: {
          locationType: "STORE",
          locationId: storeId,
          itemId,
          variantSku: "",
          type: "OUT",
          qty: -5,
          balanceQty: 2,
          refType: "SpgSale",
          refId: `TEST-KSW2-SPG-LOWER-AFTER-${token}`,
          refDocNumber: `SPGSALE/TEST-KSW2-LOWER-AFTER/${token}`,
          createdAt: new Date(T_P2.getTime() + 1),
        },
      });
      lowerEdgeAfterId = lowerEdgeAfter.id;

      const prevReport = await prisma.konsiSellThrough.create({
        data: {
          docNo: `KST/TEST-KSW2/${token}`,
          storeId,
          method: "SPG_POS",
          status: "APPROVED",
          closingStocktakeId: prevStocktakeId,
          periodStart: null,
          periodEnd: T_P2,
          createdById: userId,
          approvedById: userId,
          approvedAt: T_P2,
        },
      });
      prevReportId = prevReport.id;

      const prevLine = await prisma.konsiSellThroughLine.create({
        data: {
          sellThroughId: prevReportId,
          itemId,
          variantSku: "",
          productName: "Item C",
          openingQty: 0,
          inQty: 0,
          outQty: 0,
          posSoldQty: 0,
          gapQty: 0,
          closingQty: 7,
          countedQty: 7,
          billedQty: 0,
          shrinkageQty: 0,
          unitCost: 1000,
        },
      });
      prevLineId = prevLine.id;

      const mid = await prisma.stockLedgerEntry.create({
        data: {
          locationType: "STORE",
          locationId: storeId,
          itemId,
          variantSku: "",
          type: "IN",
          qty: 15,
          balanceQty: 22,
          refType: "KonsiTransfer",
          refId: `TEST-KSW2-KTF-MID-${token}`,
          refDocNumber: `KONSITRF/TEST-KSW2-MID/${token}`,
          createdAt: T_MID,
        },
      });
      midId = mid.id;

      /**
       * approvedAt is set EARLIER than c2's createdAt — proves the closing stocktake's own rows
       * are included regardless of that ordering (the writer note: ledger rows land via
       * setStoreStock before approvedAt is stamped, so this is a real, not contrived, ordering).
       */
      const curStocktake = await prisma.storeStocktake.create({
        data: {
          docNo: `SST/TEST-KSW2-CUR/${token}`,
          storeId,
          status: "APPROVED",
          countedAt: T_C1,
          approvedAt: T_C1,
          approvedById: userId,
          createdById: userId,
          isFullCount: true,
        },
      });
      curStocktakeId = curStocktake.id;

      const c1 = await prisma.stockLedgerEntry.create({
        data: {
          locationType: "STORE",
          locationId: storeId,
          itemId,
          variantSku: "",
          type: "OUT",
          qty: 0,
          balanceQty: 22,
          refType: "StoreStocktake",
          refId: curStocktakeId,
          refDocNumber: curStocktake.docNo,
          createdAt: T_C1,
        },
      });
      c1Id = c1.id;
      const c2 = await prisma.stockLedgerEntry.create({
        data: {
          locationType: "STORE",
          locationId: storeId,
          itemId,
          variantSku: "",
          type: "OUT",
          qty: -3,
          balanceQty: 19,
          refType: "StoreStocktake",
          refId: curStocktakeId,
          refDocNumber: curStocktake.docNo,
          createdAt: T_C2,
        },
      });
      c2Id = c2.id;

      await prisma.storeStocktakeLine.create({
        data: {
          stocktakeId: curStocktakeId,
          itemId,
          variantSku: "",
          productName: "Item C",
          expectedQty: 22,
          countedQty: 19,
          appliedQty: 19,
          qtyAtApproval: 22,
          isAdded: false,
        },
      });
    });

    afterEach(async () => {
      await prisma.stockLedgerEntry.deleteMany({
        where: { id: { in: [seededId(p1Id), seededId(p2Id), seededId(lowerEdgeAtId), seededId(lowerEdgeAfterId), seededId(midId), seededId(c1Id), seededId(c2Id)] } },
      });
      await prisma.konsiSellThroughLine.deleteMany({ where: { id: seededId(prevLineId) } });
      await prisma.konsiSellThrough.deleteMany({ where: { id: seededId(prevReportId) } });
      await prisma.storeStocktakeLine.deleteMany({ where: { stocktakeId: seededId(curStocktakeId) } });
      await prisma.storeStocktake.deleteMany({ where: { id: { in: [seededId(prevStocktakeId), seededId(curStocktakeId)] } } });
      await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
      await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
      await prisma.user.deleteMany({ where: { id: seededId(userId) } });
      await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    });

    it("periodStart is the previous boundary and periodEnd is the closing stocktake's own boundary, after its approvedAt", async () => {
      const result = await prisma.$transaction((tx) =>
        loadSellThroughInputs(tx, { storeId, closingStocktakeId: curStocktakeId, previous: { id: prevReportId, closingStocktakeId: prevStocktakeId } }),
      );
      expect(result.periodStart!.toISOString()).toBe(T_P2.toISOString());
      expect(result.periodEnd.toISOString()).toBe(T_C2.toISOString());
    });

    it("includes the closing stocktake's own rows and the in-window movement, excludes the previous stocktake's own rows", async () => {
      const result = await prisma.$transaction((tx) =>
        loadSellThroughInputs(tx, { storeId, closingStocktakeId: curStocktakeId, previous: { id: prevReportId, closingStocktakeId: prevStocktakeId } }),
      );
      const qtys = result.rows.map((r) => r.qty);
      expect(qtys).toContain(15);
      expect(qtys).toContain(0);
      expect(qtys).toContain(-3);
      expect(qtys).not.toContain(-2);
      expect(qtys).not.toContain(-1);
      expect(result.rows).toHaveLength(4);
    });

    it("takes openings from the previous report's line closingQty", async () => {
      const result = await prisma.$transaction((tx) =>
        loadSellThroughInputs(tx, { storeId, closingStocktakeId: curStocktakeId, previous: { id: prevReportId, closingStocktakeId: prevStocktakeId } }),
      );
      expect(result.openings).toEqual([{ itemId, variantSku: "", qty: 7 }]);
    });

    it("excludes a row at exactly the previous boundary and includes one 1ms after — the lower window edge is exclusive", async () => {
      const result = await prisma.$transaction((tx) =>
        loadSellThroughInputs(tx, { storeId, closingStocktakeId: curStocktakeId, previous: { id: prevReportId, closingStocktakeId: prevStocktakeId } }),
      );
      const refIds = result.rows.map((r) => r.refId);
      expect(refIds).not.toContain(`TEST-KSW2-SPG-LOWER-AT-${token}`);
      expect(refIds).toContain(`TEST-KSW2-SPG-LOWER-AFTER-${token}`);
    });
  });
});
