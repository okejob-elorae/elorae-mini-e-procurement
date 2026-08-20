import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createFieldReturn } from "./writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("createFieldReturn (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let inactiveStoreId = "";
  let userId = "";
  let otherUserId = "";
  let visitId = "";
  let otherUsersVisitId = "";
  let returnIds: string[] = [];

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    storeId = "";
    inactiveStoreId = "";
    userId = "";
    otherUserId = "";
    visitId = "";
    otherUsersVisitId = "";
    returnIds = [];

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-FR-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-FR-${token}`, nameId: "Retur item", nameEn: "Retur item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    itemId = item.id;

    const store = await prisma.store.create({
      data: { code: `TEST-FR-STORE-${token}`, name: "Test Retur Store", address: "Test address", termsType: "PUTUS", isActive: true },
    });
    storeId = store.id;

    const inactiveStore = await prisma.store.create({
      data: { code: `TEST-FR-INACTIVE-${token}`, name: "Test Inactive Retur Store", address: "Test address", termsType: "PUTUS", isActive: false },
    });
    inactiveStoreId = inactiveStore.id;

    const user = await prisma.user.create({ data: { email: `test-fr-${token}@example.com`, name: "Test Retur Salesman" } });
    userId = user.id;

    const otherUser = await prisma.user.create({ data: { email: `test-fr-other-${token}@example.com`, name: "Other Salesman" } });
    otherUserId = otherUser.id;

    const visit = await prisma.storeVisit.create({ data: { storeId, userId, checkinLat: 0, checkinLng: 0 } });
    visitId = visit.id;

    const otherVisit = await prisma.storeVisit.create({ data: { storeId, userId: otherUserId, checkinLat: 0, checkinLng: 0 } });
    otherUsersVisitId = otherVisit.id;
  });

  afterEach(async () => {
    const seededReturnIds = returnIds.map((id) => seededId(id));
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: { in: seededReturnIds } } });
    await prisma.fieldReturn.deleteMany({ where: { id: { in: seededReturnIds } } });
    await prisma.storeVisit.deleteMany({ where: { id: { in: [seededId(visitId), seededId(otherUsersVisitId)] } } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(storeId), seededId(inactiveStoreId)] } } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(userId), seededId(otherUserId)] } } });
  });

  it("issues a RET/ doc number and creates the lines", async () => {
    const res = await createFieldReturn({
      storeId,
      raisedById: userId,
      transport: "SELF_CARRY",
      notaPhotoUrl: "https://cdn.example/nota.jpg",
      notaPhotoR2Key: "field-returns/x/nota.jpg",
      lines: [{ itemId, variantSku: "", qty: 3, reason: "DAMAGED" }],
    });
    returnIds.push(res.returnId);

    expect(res.docNo.startsWith("RET/")).toBe(true);
    const lines = await prisma.fieldReturnLine.findMany({ where: { returnId: seededId(res.returnId) } });
    expect(lines).toHaveLength(1);
    expect(lines[0].qty).toBe(3);
    expect(lines[0].reason).toBe("DAMAGED");
  });

  it("issues a strictly incrementing doc number from generateDocNumber, not a client-side stamp", async () => {
    /**
     * These assertions prove the doc number comes from `generateDocNumber` rather than a
     * fabricated string: two returns created back to back get distinct numbers whose
     * numeric suffix (the last "/"-segment, per docNumber.ts's MONTHLY layout
     * "<prefix>/<year>/<month>/<padded lastNumber>") differs by exactly one, and that
     * suffix matches the `DocNumberConfig.lastNumber` row afterwards.
     *
     * They do NOT prove the transaction client is forwarded to `generateDocNumber` —
     * that would need a forced rollback (predict the next number, pre-seed a row to
     * collide on the unique `docNo`, assert `lastNumber` did not advance), which was
     * deliberately not written here. The regression that check would catch is a *gap*
     * in the RET/ sequence, not wrong data on any record: `docNo` is an internal code a
     * salesman writes on a sack, not a tax document where sequence gaps must be
     * explained. So this is verified by reading `writer.ts` (the transaction client is
     * passed as `generateDocNumber("RET", tx)`) rather than by a contrived-collision test.
     */
    const res1 = await createFieldReturn({
      storeId, raisedById: userId, transport: "SELF_CARRY",
      notaPhotoUrl: "u", notaPhotoR2Key: "k",
      lines: [{ itemId, variantSku: "", qty: 1, reason: "UNSOLD" }],
    });
    returnIds.push(res1.returnId);

    const res2 = await createFieldReturn({
      storeId, raisedById: userId, transport: "SELF_CARRY",
      notaPhotoUrl: "u", notaPhotoR2Key: "k",
      lines: [{ itemId, variantSku: "", qty: 1, reason: "UNSOLD" }],
    });
    returnIds.push(res2.returnId);

    expect(res2.docNo).not.toBe(res1.docNo);
    const suffix = (docNo: string) => {
      const segments = docNo.split("/");
      return Number(segments[segments.length - 1]);
    };
    expect(suffix(res2.docNo)).toBe(suffix(res1.docNo) + 1);

    const config = await prisma.docNumberConfig.findUnique({ where: { docType: "RET" } });
    expect(config?.lastNumber).toBe(suffix(res2.docNo));
  });

  it("defaults the status to PENDING_WAREHOUSE_RECEIVING", async () => {
    const res = await createFieldReturn({
      storeId, raisedById: userId, transport: "SELF_CARRY",
      notaPhotoUrl: "u", notaPhotoR2Key: "k",
      lines: [{ itemId, variantSku: "", qty: 1, reason: "UNSOLD" }],
    });
    returnIds.push(res.returnId);

    const row = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(res.returnId) } });
    expect(row.status).toBe("PENDING_WAREHOUSE_RECEIVING");
  });

  it("refuses EXPEDITION without a resi", async () => {
    await expect(createFieldReturn({
      storeId, raisedById: userId, transport: "EXPEDITION", expeditionName: "JNE",
      notaPhotoUrl: "u", notaPhotoR2Key: "k",
      lines: [{ itemId, variantSku: "", qty: 1, reason: "UNSOLD" }],
    })).rejects.toMatchObject({ code: "MISSING_RESI" });
  });

  it("persists expeditionName and resiNo on a valid EXPEDITION retur", async () => {
    const res = await createFieldReturn({
      storeId, raisedById: userId, transport: "EXPEDITION",
      expeditionName: "JNE", resiNo: "RESI-123",
      notaPhotoUrl: "u", notaPhotoR2Key: "k",
      lines: [{ itemId, variantSku: "", qty: 1, reason: "UNSOLD" }],
    });
    returnIds.push(res.returnId);

    const row = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(res.returnId) } });
    expect(row.expeditionName).toBe("JNE");
    expect(row.resiNo).toBe("RESI-123");
  });

  it("refuses OTHER without a reasonNote", async () => {
    await expect(createFieldReturn({
      storeId, raisedById: userId, transport: "SELF_CARRY",
      notaPhotoUrl: "u", notaPhotoR2Key: "k",
      lines: [{ itemId, variantSku: "", qty: 1, reason: "OTHER" }],
    })).rejects.toMatchObject({ code: "MISSING_REASON_NOTE" });
  });

  it("refuses a non-positive qty and creates nothing", async () => {
    await expect(createFieldReturn({
      storeId, raisedById: userId, transport: "SELF_CARRY",
      notaPhotoUrl: "u", notaPhotoR2Key: "k",
      lines: [{ itemId, variantSku: "", qty: 0, reason: "UNSOLD" }],
    })).rejects.toMatchObject({ code: "BAD_QTY" });
    const rows = await prisma.fieldReturn.findMany({ where: { storeId: seededId(storeId) } });
    expect(rows).toHaveLength(0);
  });

  it("refuses an empty lines array", async () => {
    await expect(createFieldReturn({
      storeId, raisedById: userId, transport: "SELF_CARRY",
      notaPhotoUrl: "u", notaPhotoR2Key: "k",
      lines: [],
    })).rejects.toMatchObject({ code: "NO_LINES" });
    const rows = await prisma.fieldReturn.findMany({ where: { storeId: seededId(storeId) } });
    expect(rows).toHaveLength(0);
  });

  it("refuses a store that does not exist", async () => {
    await expect(createFieldReturn({
      storeId: "does-not-exist",
      raisedById: userId, transport: "SELF_CARRY",
      notaPhotoUrl: "u", notaPhotoR2Key: "k",
      lines: [{ itemId, variantSku: "", qty: 1, reason: "UNSOLD" }],
    })).rejects.toMatchObject({ code: "STORE_NOT_FOUND" });
  });

  it("refuses an inactive store", async () => {
    await expect(createFieldReturn({
      storeId: inactiveStoreId,
      raisedById: userId, transport: "SELF_CARRY",
      notaPhotoUrl: "u", notaPhotoR2Key: "k",
      lines: [{ itemId, variantSku: "", qty: 1, reason: "UNSOLD" }],
    })).rejects.toMatchObject({ code: "STORE_NOT_FOUND" });
    const rows = await prisma.fieldReturn.findMany({ where: { storeId: seededId(inactiveStoreId) } });
    expect(rows).toHaveLength(0);
  });

  it("refuses a visitId belonging to another user", async () => {
    await expect(createFieldReturn({
      storeId, visitId: otherUsersVisitId, raisedById: userId, transport: "SELF_CARRY",
      notaPhotoUrl: "u", notaPhotoR2Key: "k",
      lines: [{ itemId, variantSku: "", qty: 1, reason: "UNSOLD" }],
    })).rejects.toMatchObject({ code: "VISIT_NOT_OWNED" });
  });

  it("accepts a visit owned by this salesman for this store", async () => {
    const res = await createFieldReturn({
      storeId, visitId, raisedById: userId, transport: "SELF_CARRY",
      notaPhotoUrl: "u", notaPhotoR2Key: "k",
      lines: [{ itemId, variantSku: "", qty: 1, reason: "UNSOLD" }],
    });
    returnIds.push(res.returnId);

    const row = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(res.returnId) } });
    expect(row.visitId).toBe(visitId);
  });

  it("creates no StockAdjustment — a raised retur moves no stock", async () => {
    const res = await createFieldReturn({
      storeId, raisedById: userId, transport: "SELF_CARRY",
      notaPhotoUrl: "u", notaPhotoR2Key: "k",
      lines: [{ itemId, variantSku: "", qty: 5, reason: "DAMAGED" }],
    });
    returnIds.push(res.returnId);

    const adj = await prisma.stockAdjustment.findMany({ where: { itemId: seededId(itemId) } });
    expect(adj).toHaveLength(0);
  });

  it("nulls stray expedition fields on a SELF_CARRY retur instead of persisting them", async () => {
    const res = await createFieldReturn({
      storeId, raisedById: userId, transport: "SELF_CARRY",
      expeditionName: "JNE", resiNo: "RESI-123",
      notaPhotoUrl: "u", notaPhotoR2Key: "k",
      lines: [{ itemId, variantSku: "", qty: 1, reason: "UNSOLD" }],
    });
    returnIds.push(res.returnId);

    const row = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(res.returnId) } });
    expect(row.expeditionName).toBeNull();
    expect(row.resiNo).toBeNull();
  });
});
