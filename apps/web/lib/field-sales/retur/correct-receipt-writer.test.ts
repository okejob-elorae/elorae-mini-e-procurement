import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createFieldReturn } from "./writer";
import { receiveFieldReturn } from "./receive-writer";
import { resolveFieldReturnLine } from "./resolve-writer";
import { approveFieldReturn } from "./approve-writer";
import { correctFieldReturnReceipt } from "./correct-receipt-writer";
import { notifySalesmanOfMismatch } from "./mismatch-notice";

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
/* The writer chains `.catch` on the sender, so the stub must return a promise. */
vi.mock("./mismatch-notice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mismatch-notice")>()),
  notifySalesmanOfMismatch: vi.fn(async () => undefined),
}));

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * Scoped to this fixture's own returns, matched in JS on `metadata.returnId` — the same approach
 * as `receive-writer.test.ts`, since this spec shares the dev DB with real notification rows.
 */
async function mismatchNotificationsFor(returnIds: string[]) {
  const recent = await prisma.adminNotification.findMany({
    where: { category: "FIELD_RETURN_MISMATCH" },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return recent.filter((n) => returnIds.includes((n.metadata as { returnId?: string } | null)?.returnId ?? ""));
}

async function latestResolution(lineId: string) {
  return prisma.fieldReturnResolution.findFirst({
    where: { lineId: seededId(lineId) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

d("correctFieldReturnReceipt (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemAId = "";
  let itemBId = "";
  let putusStoreId = "";
  let konsiStoreId = "";
  let raisedById = "";
  let adminId = "";
  /* FIELD retur at the PUTUS store: line A claims 3, line B claims 2. */
  let returnId = "";
  let lineAId = "";
  let lineBId = "";
  /* Returs a single test raises on top of the shared one, torn down with it. */
  let extraReturnIds: string[] = [];

  const counts = (a: [number, number, number], b: [number, number, number] = [2, 2, 0]) => [
    { lineId: lineAId, receivedQty: a[0], sellableQty: a[1], rejectedQty: a[2] },
    { lineId: lineBId, receivedQty: b[0], sellableQty: b[1], rejectedQty: b[2] },
  ];

  beforeEach(async () => {
    uomId = "";
    itemAId = "";
    itemBId = "";
    putusStoreId = "";
    konsiStoreId = "";
    raisedById = "";
    adminId = "";
    returnId = "";
    lineAId = "";
    lineBId = "";
    extraReturnIds = [];
    vi.mocked(notifySalesmanOfMismatch).mockClear();

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-FRC-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const itemA = await prisma.item.create({
      data: { sku: `TEST-FRC-A-${token}`, nameId: "Koreksi item A", nameEn: "Correction item A", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    itemAId = itemA.id;

    const itemB = await prisma.item.create({
      data: { sku: `TEST-FRC-B-${token}`, nameId: "Koreksi item B", nameEn: "Correction item B", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    itemBId = itemB.id;

    const putusStore = await prisma.store.create({
      data: { code: `TEST-FRC-PUTUS-${token}`, name: "Test Correction Putus Store", address: "Test address", termsType: "PUTUS", isActive: true },
    });
    putusStoreId = putusStore.id;

    const konsiStore = await prisma.store.create({
      data: { code: `TEST-FRC-KONSI-${token}`, name: "Test Correction Konsi Store", address: "Test address", termsType: "KONSI", isActive: true },
    });
    konsiStoreId = konsiStore.id;

    const raisedBy = await prisma.user.create({ data: { email: `test-frc-${token}@example.com`, name: "Test Retur Salesman" } });
    raisedById = raisedBy.id;

    const admin = await prisma.user.create({ data: { email: `test-frc-admin-${token}@example.com`, name: "Test Warehouse Admin" } });
    adminId = admin.id;

    const created = await createFieldReturn({
      storeId: putusStoreId,
      raisedById,
      transport: "SELF_CARRY",
      notaPhotoUrl: "https://cdn.example/nota.jpg",
      notaPhotoR2Key: "field-returns/x/nota.jpg",
      lines: [
        { itemId: itemAId, variantSku: "", qty: 3, reason: "DAMAGED" },
        { itemId: itemBId, variantSku: "", qty: 2, reason: "UNSOLD" },
      ],
    });
    returnId = created.returnId;

    const lines = await prisma.fieldReturnLine.findMany({ where: { returnId: seededId(returnId) } });
    lineAId = lines.find((l) => l.itemId === itemAId)!.id;
    lineBId = lines.find((l) => l.itemId === itemBId)!.id;
  });

  afterEach(async () => {
    const returnIds = [seededId(returnId), ...extraReturnIds.map((id) => seededId(id))];
    const itemIds = [seededId(itemAId), seededId(itemBId)];
    const storeIds = [seededId(putusStoreId), seededId(konsiStoreId)];

    const notifications = await mismatchNotificationsFor(returnIds);
    if (notifications.length) {
      await prisma.adminNotification.deleteMany({ where: { id: { in: notifications.map((n) => n.id) } } });
    }
    await prisma.auditLog.deleteMany({ where: { entityType: "FieldReturn", entityId: { in: returnIds } } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.rejectedGoodsLedger.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.storeStock.deleteMany({ where: { storeId: { in: storeIds } } });
    await prisma.fieldReturnResolution.deleteMany({ where: { line: { returnId: { in: returnIds } } } });
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: { in: returnIds } } });
    await prisma.fieldReturn.deleteMany({ where: { id: { in: returnIds } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(raisedById), seededId(adminId)] } } });
  });

  it("refuses a retur that has not been received yet with INVALID_STATE and writes nothing", async () => {
    await expect(
      correctFieldReturnReceipt({ returnId, correctedById: adminId, reason: "salah ketik", counts: counts([3, 3, 0]) }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });

    const a = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(lineAId) } });
    expect(a.receivedQty).toBeNull();
    const audits = await prisma.auditLog.findMany({ where: { entityId: seededId(returnId) } });
    expect(audits).toHaveLength(0);
  });

  it("refuses an APPROVED retur with INVALID_STATE and leaves its counts alone", async () => {
    await receiveFieldReturn({ returnId, receivedById: adminId, counts: counts([3, 3, 0]) });
    await approveFieldReturn({ returnId, approvedById: adminId });

    await expect(
      correctFieldReturnReceipt({ returnId, correctedById: adminId, reason: "salah ketik", counts: counts([1, 1, 0]) }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });

    const a = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(lineAId) } });
    expect(a.receivedQty).toBe(3);
    const audits = await prisma.auditLog.findMany({ where: { entityId: seededId(returnId) } });
    expect(audits).toHaveLength(0);
  });

  it("refuses a blank reason with MISSING_REASON before touching anything", async () => {
    await receiveFieldReturn({ returnId, receivedById: adminId, counts: counts([3, 3, 0]) });

    await expect(
      correctFieldReturnReceipt({ returnId, correctedById: adminId, reason: "   ", counts: counts([1, 1, 0]) }),
    ).rejects.toMatchObject({ code: "MISSING_REASON" });

    const a = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(lineAId) } });
    expect(a.receivedQty).toBe(3);
  });

  it("refuses a payload that omits a line, exactly like receiving", async () => {
    await receiveFieldReturn({ returnId, receivedById: adminId, counts: counts([3, 3, 0]) });

    await expect(
      correctFieldReturnReceipt({
        returnId,
        correctedById: adminId,
        reason: "salah ketik",
        counts: [{ lineId: lineAId, receivedQty: 1, sellableQty: 1, rejectedQty: 0 }],
      }),
    ).rejects.toMatchObject({ code: "MISSING_LINE" });
  });

  it("moves a clean retur into resolution when corrected to a short count, and records before/after", async () => {
    await receiveFieldReturn({ returnId, receivedById: adminId, counts: counts([3, 3, 0]) });
    expect(await mismatchNotificationsFor([returnId])).toHaveLength(0);

    const res = await correctFieldReturnReceipt({
      returnId,
      correctedById: adminId,
      reason: "salah ketik, yang datang cuma 1",
      counts: counts([1, 1, 0]),
    });
    expect(res.status).toBe("MISMATCH_PENDING_RESOLUTION");

    const row = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(returnId) } });
    expect(row.status).toBe("MISMATCH_PENDING_RESOLUTION");
    const a = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(lineAId) } });
    expect(a.receivedQty).toBe(1);
    expect(a.sellableQty).toBe(1);

    /* No resolution existed, so none is appended — the line is simply unresolved now. */
    const resolutions = await prisma.fieldReturnResolution.findMany({ where: { lineId: seededId(lineAId) } });
    expect(resolutions).toHaveLength(0);

    const audits = await prisma.auditLog.findMany({ where: { entityId: seededId(returnId) } });
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("FIELD_RETURN_RECEIPT_CORRECT");
    expect(audits[0].userId).toBe(adminId);
    expect(audits[0].reason).toBe("salah ketik, yang datang cuma 1");
    const metadata = audits[0].metadata as {
      docNo: string;
      lines: { lineId: string; before: { receivedQty: number }; after: { receivedQty: number } }[];
    };
    expect(metadata.docNo).toBe(row.docNo);
    const lineAAudit = metadata.lines.find((l) => l.lineId === lineAId)!;
    expect(lineAAudit.before.receivedQty).toBe(3);
    expect(lineAAudit.after.receivedQty).toBe(1);

    const notifications = await mismatchNotificationsFor([returnId]);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].metadata).toMatchObject({ returnId, mismatchedLineCount: 1 });
    expect(notifySalesmanOfMismatch).toHaveBeenCalledTimes(1);
    expect(notifySalesmanOfMismatch).toHaveBeenCalledWith({
      raisedById,
      returnId,
      docNo: row.docNo,
      storeId: putusStoreId,
      mismatchedLineCount: 1,
    });
  });

  it("retires a WRITE_OFF on a line corrected to a different shortfall", async () => {
    await receiveFieldReturn({ returnId, receivedById: adminId, counts: counts([1, 1, 0]) });
    await resolveFieldReturnLine({ lineId: lineAId, type: "WRITE_OFF", createdById: adminId });

    const res = await correctFieldReturnReceipt({
      returnId,
      correctedById: adminId,
      reason: "hitung ulang",
      counts: counts([2, 2, 0]),
    });
    expect(res.status).toBe("MISMATCH_PENDING_RESOLUTION");

    const latest = await latestResolution(lineAId);
    expect(latest?.type).toBe("INVESTIGATE");
    expect(latest?.qty).toBe(1);
    expect(latest?.note).toContain("1 → 2");
    expect(latest?.note).toContain("hitung ulang");
  });

  it("settles a WRITE_OFF line corrected to an exact count — zero variance needs no resolution", async () => {
    await receiveFieldReturn({ returnId, receivedById: adminId, counts: counts([1, 1, 0]) });
    await resolveFieldReturnLine({ lineId: lineAId, type: "WRITE_OFF", createdById: adminId });

    const res = await correctFieldReturnReceipt({
      returnId,
      correctedById: adminId,
      reason: "ternyata lengkap",
      counts: counts([3, 3, 0]),
    });
    expect(res.status).toBe("PENDING_APPROVAL");

    const resolutions = await prisma.fieldReturnResolution.findMany({ where: { lineId: seededId(lineAId) } });
    expect(resolutions).toHaveLength(2);
    const latest = await latestResolution(lineAId);
    expect(latest?.type).toBe("INVESTIGATE");
    expect(latest?.qty).toBe(0);
  });

  it("appends nothing when only the sellable/rejected split changes", async () => {
    await receiveFieldReturn({ returnId, receivedById: adminId, counts: counts([1, 1, 0]) });
    await resolveFieldReturnLine({ lineId: lineAId, type: "WRITE_OFF", createdById: adminId });

    const res = await correctFieldReturnReceipt({
      returnId,
      correctedById: adminId,
      reason: "barangnya rusak",
      counts: counts([1, 0, 1]),
    });
    expect(res.status).toBe("PENDING_APPROVAL");

    const resolutions = await prisma.fieldReturnResolution.findMany({ where: { lineId: seededId(lineAId) } });
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].type).toBe("WRITE_OFF");
    const a = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(lineAId) } });
    expect(a.sellableQty).toBe(0);
    expect(a.rejectedQty).toBe(1);
  });

  it("moves an ADMIN retur's KONSI store stock by the corrected delta only", async () => {
    await prisma.storeStock.create({ data: { storeId: konsiStoreId, itemId: itemAId, variantSku: "", qty: 10, avgCost: 10000 } });
    const created = await createFieldReturn({
      storeId: konsiStoreId,
      raisedById,
      origin: "ADMIN",
      lines: [{ itemId: itemAId, variantSku: "", qty: 5, reason: "UNSOLD" }],
    });
    extraReturnIds.push(created.returnId);
    const line = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(created.returnId) } });

    await receiveFieldReturn({
      returnId: created.returnId,
      receivedById: adminId,
      counts: [{ lineId: line.id, receivedQty: 5, sellableQty: 5, rejectedQty: 0 }],
    });
    const afterReceipt = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(konsiStoreId), itemId: seededId(itemAId) } });
    expect(Number(afterReceipt.qty)).toBe(5);

    await correctFieldReturnReceipt({
      returnId: created.returnId,
      correctedById: adminId,
      reason: "salah ketik",
      counts: [{ lineId: line.id, receivedQty: 3, sellableQty: 3, rejectedQty: 0 }],
    });

    /* Received 5 → corrected 3: two units go back onto the store row, 10 - 5 + 2 = 7. */
    const afterCorrection = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(konsiStoreId), itemId: seededId(itemAId) } });
    expect(Number(afterCorrection.qty)).toBe(7);

    const ledger = await prisma.stockLedgerEntry.findMany({
      where: { refType: "FieldReturn", refId: seededId(created.returnId), locationType: "STORE" },
      orderBy: { createdAt: "asc" },
    });
    expect(ledger.map((e) => Number(e.qty)).sort((x, y) => x - y)).toEqual([-5, 2]);

    /* An ADMIN retur has no salesman to tell. */
    expect(notifySalesmanOfMismatch).not.toHaveBeenCalled();
  });

  it("leaves a FIELD retur's KONSI store stock untouched — it moves only at approval", async () => {
    await prisma.storeStock.create({ data: { storeId: konsiStoreId, itemId: itemBId, variantSku: "", qty: 10, avgCost: 10000 } });
    const created = await createFieldReturn({
      storeId: konsiStoreId,
      raisedById,
      transport: "SELF_CARRY",
      notaPhotoUrl: "https://cdn.example/nota.jpg",
      notaPhotoR2Key: "field-returns/x/nota.jpg",
      lines: [{ itemId: itemBId, variantSku: "", qty: 4, reason: "UNSOLD" }],
    });
    extraReturnIds.push(created.returnId);
    const line = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(created.returnId) } });

    await receiveFieldReturn({
      returnId: created.returnId,
      receivedById: adminId,
      counts: [{ lineId: line.id, receivedQty: 4, sellableQty: 4, rejectedQty: 0 }],
    });
    await correctFieldReturnReceipt({
      returnId: created.returnId,
      correctedById: adminId,
      reason: "salah ketik",
      counts: [{ lineId: line.id, receivedQty: 2, sellableQty: 2, rejectedQty: 0 }],
    });

    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(konsiStoreId), itemId: seededId(itemBId) } });
    expect(Number(ss.qty)).toBe(10);
    const ledger = await prisma.stockLedgerEntry.findMany({ where: { refId: seededId(created.returnId) } });
    expect(ledger).toHaveLength(0);
  });

  it("approval credits off the CORRECTED received count once the line is resolved again", async () => {
    await receiveFieldReturn({ returnId, receivedById: adminId, counts: counts([5, 5, 0]) });
    await resolveFieldReturnLine({ lineId: lineAId, type: "ACCEPT_SURPLUS", createdById: adminId });

    const corrected = await correctFieldReturnReceipt({
      returnId,
      correctedById: adminId,
      reason: "kelebihannya cuma 1",
      counts: counts([4, 4, 0]),
    });
    expect(corrected.status).toBe("MISMATCH_PENDING_RESOLUTION");

    await resolveFieldReturnLine({ lineId: lineAId, type: "ACCEPT_SURPLUS", createdById: adminId });
    await approveFieldReturn({ returnId, approvedById: adminId });

    const a = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(lineAId) } });
    expect(a.creditedQty).toBe(4);
    const latest = await latestResolution(lineAId);
    expect(latest?.type).toBe("ACCEPT_SURPLUS");
    expect(latest?.qty).toBe(1);
  });
});
