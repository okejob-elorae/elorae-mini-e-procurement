import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { formatMovedAtInput, parseMovedAtInput } from "./moved-at";
import { createStoreTransfer, approveStoreTransfer } from "./writer";

/* Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const HOUR = 3_600_000;

d("store transfer writer (test bed only)", () => {
  const tag = `STRW-${Math.random().toString(36).slice(2, 10)}`;
  let run = 0;
  let stocktakeCounter = 0;
  let uomId = "";
  let userId = "";
  let itemId = "";
  let otherItemId = "";
  let storeAId = "";
  let storeBId = "";

  const stores = () => [seededId(storeAId), seededId(storeBId)];

  type CountLine = { itemId: string; variantSku?: string; countedQty: number | null };

  /**
   * A count at a store, written directly in its final state — the transfer writer only reads its
   * status, its two count timestamps and which item::variant keys it counted. By default it counts
   * the transferred item.
   */
  const count = async (
    storeId: string,
    at: { status?: "APPROVED" | "PENDING_VERIFICATION"; countFinishedAt: Date | null; approvedAt: Date | null; lines?: CountLine[] },
  ) =>
    prisma.storeStocktake.create({
      data: {
        docNo: `STK/${tag}/${run}/${++stocktakeCounter}`,
        storeId,
        status: at.status ?? "APPROVED",
        openKey: at.status === "PENDING_VERIFICATION" ? storeId : null,
        countedAt: at.countFinishedAt ?? at.approvedAt ?? new Date(),
        countFinishedAt: at.countFinishedAt,
        approvedAt: at.approvedAt,
        approvedById: at.approvedAt ? userId : null,
        createdById: userId,
        isFullCount: true,
        lines: {
          create: (at.lines ?? [{ itemId, countedQty: 7 }]).map((l) => ({
            itemId: l.itemId,
            variantSku: l.variantSku ?? "",
            productName: "Counted line",
            expectedQty: 0,
            countedQty: l.countedQty,
          })),
        },
      },
      select: { id: true, docNo: true },
    });

  /* Three units of the item from store A to store B. */
  const newTransfer = (movedAt: Date) =>
    createStoreTransfer({
      fromStoreId: storeAId,
      toStoreId: storeBId,
      movedAt,
      createdById: userId,
      lines: [{ itemId, variantSku: "", qty: 3 }],
    });

  const qtyAt = async (storeId: string) => {
    const row = await prisma.storeStock.findUnique({
      where: { storeId_itemId_variantSku: { storeId, itemId, variantSku: "" } },
      select: { qty: true },
    });
    return row ? Number(row.qty) : 0;
  };

  const transferRows = () =>
    prisma.stockLedgerEntry.findMany({
      where: { itemId: seededId(itemId), refType: "StoreTransfer" },
      orderBy: { qty: "asc" },
    });

  /* Six hours ago, so counts can sit on either side of the move without reaching the future. */
  const pastMove = () => new Date(Date.now() - 6 * HOUR);

  /* HH:mm on yesterday's WIB date, as the create form would submit it. */
  const yesterdayAt = (hhmm: string) => parseMovedAtInput(`${formatMovedAtInput(new Date(Date.now() - 24 * HOUR)).slice(0, 10)}T${hhmm}`)!;

  beforeEach(async () => {
    uomId = "";
    userId = "";
    itemId = "";
    otherItemId = "";
    storeAId = "";
    storeBId = "";
    run += 1;

    const uom = await prisma.uOM.create({ data: { code: `U-${tag}-${run}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const user = await prisma.user.create({ data: { email: `test-strw-${tag}-${run}@example.com`, name: "Test Transfer User" } });
    userId = user.id;
    const item = await prisma.item.create({
      data: { sku: `${tag}-${run}-ITEM`, nameId: "Transfer item", nameEn: "Transfer item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 1000 },
    });
    itemId = item.id;
    const otherItem = await prisma.item.create({
      data: { sku: `${tag}-${run}-OTHER`, nameId: "Unrelated item", nameEn: "Unrelated item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 1000 },
    });
    otherItemId = otherItem.id;
    const a = await prisma.store.create({ data: { code: `${tag}-${run}-A`, name: "Test Transfer Store A", address: "Jl. Test", termsType: "KONSI", isActive: true } });
    storeAId = a.id;
    const b = await prisma.store.create({ data: { code: `${tag}-${run}-B`, name: "Test Transfer Store B", address: "Jl. Test", termsType: "KONSI", isActive: true } });
    storeBId = b.id;
    await prisma.storeStock.create({ data: { storeId: storeAId, itemId, variantSku: "", qty: 10, avgCost: 5000 } });
  });

  afterEach(async () => {
    const transferWhere = { OR: [{ fromStoreId: { in: stores() } }, { toStoreId: { in: stores() } }] };
    await prisma.storeTransferLine.deleteMany({ where: { transfer: transferWhere } });
    await prisma.storeTransfer.deleteMany({ where: transferWhere });
    await prisma.storeStocktakeLine.deleteMany({ where: { stocktake: { storeId: { in: stores() } } } });
    await prisma.storeStocktake.deleteMany({ where: { storeId: { in: stores() } } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.storeStock.deleteMany({ where: { storeId: { in: stores() } } });
    await prisma.store.deleteMany({ where: { id: { in: stores() } } });
    await prisma.item.deleteMany({ where: { id: { in: [seededId(itemId), seededId(otherItemId)] } } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  describe("createStoreTransfer", () => {
    it("stores the move instant it is given and moves no stock", async () => {
      const movedAt = pastMove();
      const { transferId } = await newTransfer(movedAt);
      const row = await prisma.storeTransfer.findUniqueOrThrow({ where: { id: seededId(transferId) } });
      expect(row.movedAt.toISOString()).toBe(movedAt.toISOString());
      expect(row.status).toBe("PENDING");
      expect(await qtyAt(storeAId)).toBe(10);
      expect(await transferRows()).toHaveLength(0);
    });

    it("accepts a move of right now", async () => {
      await expect(newTransfer(new Date())).resolves.toMatchObject({ transferId: expect.any(String) });
    });

    it("accepts a move a minute ahead of the server clock, as a slightly fast browser clock would stamp it", async () => {
      await expect(newTransfer(new Date(Date.now() + 60_000))).resolves.toMatchObject({ transferId: expect.any(String) });
    });

    it("refuses MOVED_AT_IN_FUTURE for a move ten minutes from now, and creates nothing", async () => {
      await expect(newTransfer(new Date(Date.now() + 10 * 60_000))).rejects.toMatchObject({ code: "MOVED_AT_IN_FUTURE" });
      expect(await prisma.storeTransfer.count({ where: { fromStoreId: seededId(storeAId) } })).toBe(0);
    });
  });

  describe("approveStoreTransfer", () => {
    it("moves both legs with the transfer id as refId when the count moment predates the move, even for a count approved after it", async () => {
      const movedAt = pastMove();
      /* countFinishedAt governs; approvedAt is read only when countFinishedAt is null. */
      await count(storeAId, { countFinishedAt: new Date(movedAt.getTime() - 2 * HOUR), approvedAt: new Date(movedAt.getTime() + HOUR) });
      const { transferId } = await newTransfer(movedAt);

      await approveStoreTransfer({ transferId, approvedById: userId });

      expect(await qtyAt(storeAId)).toBe(7);
      expect(await qtyAt(storeBId)).toBe(3);
      const rows = await transferRows();
      expect(rows.map((r) => ({ locationId: r.locationId, qty: Number(r.qty), refId: r.refId }))).toEqual([
        { locationId: storeAId, qty: -3, refId: transferId },
        { locationId: storeBId, qty: 3, refId: transferId },
      ]);
    });

    it("refuses COUNTED_SINCE_MOVE naming the count when the source counted the item after the move, and moves nothing", async () => {
      const movedAt = pastMove();
      const st = await count(storeAId, { countFinishedAt: new Date(movedAt.getTime() + HOUR), approvedAt: new Date(movedAt.getTime() + 2 * HOUR) });
      const { transferId } = await newTransfer(movedAt);

      await expect(approveStoreTransfer({ transferId, approvedById: userId })).rejects.toMatchObject({ code: "COUNTED_SINCE_MOVE", detail: st.docNo });

      const row = await prisma.storeTransfer.findUniqueOrThrow({ where: { id: seededId(transferId) } });
      expect(row.status).toBe("PENDING");
      expect(row.approvedAt).toBeNull();
      expect(await qtyAt(storeAId)).toBe(10);
      expect(await transferRows()).toHaveLength(0);
    });

    it("refuses COUNTED_SINCE_MOVE when only the destination counted the item after the move", async () => {
      const movedAt = pastMove();
      const st = await count(storeBId, { countFinishedAt: new Date(movedAt.getTime() + HOUR), approvedAt: new Date(movedAt.getTime() + 2 * HOUR) });
      const { transferId } = await newTransfer(movedAt);
      await expect(approveStoreTransfer({ transferId, approvedById: userId })).rejects.toMatchObject({ code: "COUNTED_SINCE_MOVE", detail: st.docNo });
    });

    it("names every count at either store, in docNo order", async () => {
      const movedAt = pastMove();
      const a = await count(storeAId, { countFinishedAt: new Date(movedAt.getTime() + HOUR), approvedAt: new Date(movedAt.getTime() + 2 * HOUR) });
      const b = await count(storeBId, { countFinishedAt: new Date(movedAt.getTime() + HOUR), approvedAt: new Date(movedAt.getTime() + 2 * HOUR) });
      const { transferId } = await newTransfer(movedAt);
      await expect(approveStoreTransfer({ transferId, approvedById: userId })).rejects.toMatchObject({
        code: "COUNTED_SINCE_MOVE",
        detail: `${a.docNo}, ${b.docNo}`,
      });
    });

    it("keys a count saved before countFinishedAt existed on its approvedAt", async () => {
      const movedAt = pastMove();
      await count(storeAId, { countFinishedAt: null, approvedAt: new Date(movedAt.getTime() + HOUR) });
      const { transferId } = await newTransfer(movedAt);
      await expect(approveStoreTransfer({ transferId, approvedById: userId })).rejects.toMatchObject({ code: "COUNTED_SINCE_MOVE" });
    });

    it("compares instants on the same day: a count at 10:00 does not block a move at 14:00, a count at 15:00 does", async () => {
      const movedAt = yesterdayAt("14:00");
      await count(storeAId, { countFinishedAt: yesterdayAt("10:00"), approvedAt: yesterdayAt("10:30") });
      const { transferId: before } = await newTransfer(movedAt);
      await approveStoreTransfer({ transferId: before, approvedById: userId });
      expect(await qtyAt(storeAId)).toBe(7);

      await count(storeAId, { countFinishedAt: yesterdayAt("15:00"), approvedAt: yesterdayAt("15:30") });
      const { transferId: after } = await newTransfer(movedAt);
      await expect(approveStoreTransfer({ transferId: after, approvedById: userId })).rejects.toMatchObject({ code: "COUNTED_SINCE_MOVE" });
    });

    it("does not block over a partial count that never counted the transferred item", async () => {
      const movedAt = pastMove();
      await count(storeAId, {
        countFinishedAt: new Date(movedAt.getTime() + HOUR),
        approvedAt: new Date(movedAt.getTime() + 2 * HOUR),
        lines: [{ itemId: otherItemId, countedQty: 0 }],
      });
      const { transferId } = await newTransfer(movedAt);
      await approveStoreTransfer({ transferId, approvedById: userId });
      expect(await qtyAt(storeAId)).toBe(7);
    });

    it("matches on item AND variant: a count of another variant of the item does not block", async () => {
      const movedAt = pastMove();
      await count(storeAId, {
        countFinishedAt: new Date(movedAt.getTime() + HOUR),
        approvedAt: new Date(movedAt.getTime() + 2 * HOUR),
        lines: [{ itemId, variantSku: "RED", countedQty: 0 }],
      });
      const { transferId } = await newTransfer(movedAt);
      await approveStoreTransfer({ transferId, approvedById: userId });
      expect(await qtyAt(storeAId)).toBe(7);
    });

    it("an uncounted line for the transferred item does not block — the count never saw it", async () => {
      const movedAt = pastMove();
      await count(storeAId, {
        countFinishedAt: new Date(movedAt.getTime() + HOUR),
        approvedAt: new Date(movedAt.getTime() + 2 * HOUR),
        lines: [{ itemId, countedQty: null }, { itemId: otherItemId, countedQty: 0 }],
      });
      const { transferId } = await newTransfer(movedAt);
      await approveStoreTransfer({ transferId, approvedById: userId });
      expect(await qtyAt(storeAId)).toBe(7);
    });

    it("a count that counted the item among others still blocks", async () => {
      const movedAt = pastMove();
      await count(storeAId, {
        countFinishedAt: new Date(movedAt.getTime() + HOUR),
        approvedAt: new Date(movedAt.getTime() + 2 * HOUR),
        lines: [{ itemId: otherItemId, countedQty: 0 }, { itemId, countedQty: 7 }],
      });
      const { transferId } = await newTransfer(movedAt);
      await expect(approveStoreTransfer({ transferId, approvedById: userId })).rejects.toMatchObject({ code: "COUNTED_SINCE_MOVE" });
    });

    it("ignores a count that is not approved yet", async () => {
      const movedAt = pastMove();
      await count(storeAId, { status: "PENDING_VERIFICATION", countFinishedAt: new Date(movedAt.getTime() + HOUR), approvedAt: null });
      const { transferId } = await newTransfer(movedAt);
      await approveStoreTransfer({ transferId, approvedById: userId });
      expect(await qtyAt(storeAId)).toBe(7);
    });

    it("a second approve refuses INVALID_STATE, not COUNTED_SINCE_MOVE, once a later count exists", async () => {
      const { transferId } = await newTransfer(pastMove());
      await approveStoreTransfer({ transferId, approvedById: userId });
      await count(storeAId, { countFinishedAt: new Date(), approvedAt: new Date() });
      await expect(approveStoreTransfer({ transferId, approvedById: userId })).rejects.toMatchObject({ code: "INVALID_STATE" });
      expect(await qtyAt(storeAId)).toBe(7);
    });
  });
});
