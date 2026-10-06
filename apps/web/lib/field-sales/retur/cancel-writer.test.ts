import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createFieldReturn } from "./writer";
import { receiveFieldReturn } from "./receive-writer";
import { resolveFieldReturnLine } from "./resolve-writer";
import { approveFieldReturn } from "./approve-writer";
import { cancelFieldReturn } from "./cancel-writer";
import { getFieldReturnById } from "./queries";

/* The receive fixtures below can land a mismatch, which notifies — keep both senders inert. */
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("./mismatch-notice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mismatch-notice")>()),
  notifySalesmanOfMismatch: vi.fn(async () => undefined),
}));

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/** Same scoped lookup as `receive-writer.test.ts` — the shared bed holds real notification rows. */
async function mismatchNotificationsFor(returnIds: string[]) {
  const recent = await prisma.adminNotification.findMany({
    where: { category: "FIELD_RETURN_MISMATCH" },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return recent.filter((n) => returnIds.includes((n.metadata as { returnId?: string } | null)?.returnId ?? ""));
}

d("cancelFieldReturn (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let raisedById = "";
  let adminId = "";
  /* FIELD retur at a KONSI store, claiming 3 of one item. */
  let fieldReturnId = "";
  let fieldLineId = "";
  /* ADMIN retur at the same store, claiming 2 of the same item. */
  let adminReturnId = "";

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    storeId = "";
    raisedById = "";
    adminId = "";
    fieldReturnId = "";
    fieldLineId = "";
    adminReturnId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-FRX-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-FRX-${token}`, nameId: "Batal item", nameEn: "Cancel item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    itemId = item.id;

    const store = await prisma.store.create({
      data: { code: `TEST-FRX-KONSI-${token}`, name: "Test Retur Cancel Store", address: "Test address", termsType: "KONSI", isActive: true },
    });
    storeId = store.id;
    await prisma.storeStock.create({ data: { storeId, itemId, variantSku: "", qty: 10, avgCost: 10000 } });

    const raisedBy = await prisma.user.create({ data: { email: `test-frx-${token}@example.com`, name: "Test Retur Salesman" } });
    raisedById = raisedBy.id;

    const admin = await prisma.user.create({ data: { email: `test-frx-admin-${token}@example.com`, name: "Test Warehouse Admin" } });
    adminId = admin.id;

    const field = await createFieldReturn({
      storeId,
      raisedById,
      transport: "SELF_CARRY",
      notaPhotoUrl: "https://cdn.example/nota.jpg",
      notaPhotoR2Key: "field-returns/x/nota.jpg",
      lines: [{ itemId, variantSku: "", qty: 3, reason: "UNSOLD" }],
    });
    fieldReturnId = field.returnId;
    const fieldLine = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(fieldReturnId) } });
    fieldLineId = fieldLine.id;

    const adminRet = await createFieldReturn({
      storeId,
      raisedById: adminId,
      origin: "ADMIN",
      lines: [{ itemId, variantSku: "", qty: 2, reason: "UNSOLD" }],
    });
    adminReturnId = adminRet.returnId;
  });

  afterEach(async () => {
    const returnIds = [seededId(fieldReturnId), seededId(adminReturnId)];
    const itemIds = [seededId(itemId)];

    const notifications = await mismatchNotificationsFor(returnIds);
    if (notifications.length) {
      await prisma.adminNotification.deleteMany({ where: { id: { in: notifications.map((n) => n.id) } } });
    }
    await prisma.auditLog.deleteMany({ where: { entityType: "FieldReturn", entityId: { in: returnIds } } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.rejectedGoodsLedger.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.storeStock.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.fieldReturnResolution.deleteMany({ where: { line: { returnId: { in: returnIds } } } });
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: { in: returnIds } } });
    await prisma.fieldReturn.deleteMany({ where: { id: { in: returnIds } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(raisedById), seededId(adminId)] } } });
  });

  async function expectCancelled(returnId: string, origin: "FIELD" | "ADMIN") {
    const row = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(returnId) } });
    expect(row.status).toBe("CANCELLED");

    const audits = await prisma.auditLog.findMany({ where: { entityType: "FieldReturn", entityId: seededId(returnId) } });
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("FIELD_RETURN_CANCEL");
    expect(audits[0].userId).toBe(adminId);
    expect(audits[0].reason).toBe("barang tidak jadi dikirim");
    expect(audits[0].metadata).toMatchObject({ docNo: row.docNo, origin });

    const ledger = await prisma.stockLedgerEntry.findMany({ where: { refId: seededId(returnId) } });
    expect(ledger).toHaveLength(0);
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemId) } });
    expect(Number(ss.qty)).toBe(10);
  }

  it("cancels an unreceived FIELD retur without moving stock", async () => {
    const res = await cancelFieldReturn({ returnId: fieldReturnId, cancelledById: adminId, reason: "  barang tidak jadi dikirim  " });
    expect(res).toEqual({ ok: true, storeId });
    await expectCancelled(fieldReturnId, "FIELD");

    /* The detail page reads who, when and why off the audit row — FieldReturn has no cancel columns. */
    const detail = await getFieldReturnById(fieldReturnId);
    expect(detail?.cancellation).toMatchObject({ byLabel: "Test Warehouse Admin", reason: "barang tidak jadi dikirim" });
  });

  it("cancels an unreceived ADMIN retur without moving stock", async () => {
    const res = await cancelFieldReturn({ returnId: adminReturnId, cancelledById: adminId, reason: "barang tidak jadi dikirim" });
    expect(res).toEqual({ ok: true, storeId });
    await expectCancelled(adminReturnId, "ADMIN");
  });

  it("refuses a second cancel with INVALID_STATE and writes no second audit row", async () => {
    await cancelFieldReturn({ returnId: fieldReturnId, cancelledById: adminId, reason: "barang tidak jadi dikirim" });
    await expect(
      cancelFieldReturn({ returnId: fieldReturnId, cancelledById: adminId, reason: "lagi" }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });

    const audits = await prisma.auditLog.findMany({ where: { entityType: "FieldReturn", entityId: seededId(fieldReturnId) } });
    expect(audits).toHaveLength(1);
  });

  it("refuses a retur in MISMATCH_PENDING_RESOLUTION", async () => {
    await receiveFieldReturn({
      returnId: fieldReturnId,
      receivedById: adminId,
      counts: [{ lineId: fieldLineId, receivedQty: 1, sellableQty: 1, rejectedQty: 0 }],
    });
    await expect(
      cancelFieldReturn({ returnId: fieldReturnId, cancelledById: adminId, reason: "batal" }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    const row = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(fieldReturnId) } });
    expect(row.status).toBe("MISMATCH_PENDING_RESOLUTION");
  });

  it("refuses a retur in PENDING_APPROVAL", async () => {
    await receiveFieldReturn({
      returnId: fieldReturnId,
      receivedById: adminId,
      counts: [{ lineId: fieldLineId, receivedQty: 1, sellableQty: 1, rejectedQty: 0 }],
    });
    await resolveFieldReturnLine({ lineId: fieldLineId, type: "WRITE_OFF", createdById: adminId });
    await expect(
      cancelFieldReturn({ returnId: fieldReturnId, cancelledById: adminId, reason: "batal" }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    const row = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(fieldReturnId) } });
    expect(row.status).toBe("PENDING_APPROVAL");
  });

  it("refuses an APPROVED retur", async () => {
    await receiveFieldReturn({
      returnId: fieldReturnId,
      receivedById: adminId,
      counts: [{ lineId: fieldLineId, receivedQty: 3, sellableQty: 3, rejectedQty: 0 }],
    });
    await approveFieldReturn({ returnId: fieldReturnId, approvedById: adminId });
    await expect(
      cancelFieldReturn({ returnId: fieldReturnId, cancelledById: adminId, reason: "batal" }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    const row = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(fieldReturnId) } });
    expect(row.status).toBe("APPROVED");
  });

  it("refuses a returnId that does not exist with NOT_FOUND", async () => {
    await expect(
      cancelFieldReturn({ returnId: "clnonexistentreturnid00000000", cancelledById: adminId, reason: "batal" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a blank reason with MISSING_REASON and leaves the retur open", async () => {
    await expect(
      cancelFieldReturn({ returnId: fieldReturnId, cancelledById: adminId, reason: "   " }),
    ).rejects.toMatchObject({ code: "MISSING_REASON" });
    const row = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(fieldReturnId) } });
    expect(row.status).toBe("PENDING_WAREHOUSE_RECEIVING");
  });

  it("caps an overlong reason to the audit column's 191 characters", async () => {
    await cancelFieldReturn({ returnId: fieldReturnId, cancelledById: adminId, reason: "x".repeat(300) });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "FieldReturn", entityId: seededId(fieldReturnId) } });
    expect(audit.reason).toHaveLength(191);
  });
});
