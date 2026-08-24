import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createFieldReturn } from "./writer";
import { receiveFieldReturn } from "./receive-writer";
import { resolveFieldReturnLine } from "./resolve-writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("resolveFieldReturnLine (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemAId = "";
  let itemBId = "";
  let storeId = "";
  let raisedById = "";
  let adminId = "";
  let returnId = "";
  let shortLineId = "";
  let cleanLineId = "";
  let unreceivedReturnId = "";
  let unreceivedLineId = "";

  beforeEach(async () => {
    uomId = "";
    itemAId = "";
    itemBId = "";
    storeId = "";
    raisedById = "";
    adminId = "";
    returnId = "";
    shortLineId = "";
    cleanLineId = "";
    unreceivedReturnId = "";
    unreceivedLineId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-FRS-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const itemA = await prisma.item.create({
      data: { sku: `TEST-FRS-A-${token}`, nameId: "Retur resolve item A", nameEn: "Retur resolve item A", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    itemAId = itemA.id;

    const itemB = await prisma.item.create({
      data: { sku: `TEST-FRS-B-${token}`, nameId: "Retur resolve item B", nameEn: "Retur resolve item B", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    itemBId = itemB.id;

    const store = await prisma.store.create({
      data: { code: `TEST-FRS-STORE-${token}`, name: "Test Retur Resolve Store", address: "Test address", termsType: "PUTUS", isActive: true },
    });
    storeId = store.id;

    const raisedBy = await prisma.user.create({ data: { email: `test-frs-${token}@example.com`, name: "Test Retur Salesman" } });
    raisedById = raisedBy.id;

    const admin = await prisma.user.create({ data: { email: `test-frs-admin-${token}@example.com`, name: "Test Warehouse Admin" } });
    adminId = admin.id;

    /* Retur A: received with one short line and one clean line. */
    const created = await createFieldReturn({
      storeId,
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
    shortLineId = lines.find((l) => l.itemId === itemAId)!.id;
    cleanLineId = lines.find((l) => l.itemId === itemBId)!.id;

    await receiveFieldReturn({
      returnId,
      receivedById: adminId,
      counts: [
        { lineId: shortLineId, receivedQty: 1, sellableQty: 1, rejectedQty: 0 },
        { lineId: cleanLineId, receivedQty: 2, sellableQty: 2, rejectedQty: 0 },
      ],
    });

    /* Retur B: left at PENDING_WAREHOUSE_RECEIVING — the not-yet-received case. */
    const unreceived = await createFieldReturn({
      storeId,
      raisedById,
      transport: "SELF_CARRY",
      notaPhotoUrl: "https://cdn.example/nota2.jpg",
      notaPhotoR2Key: "field-returns/x/nota2.jpg",
      lines: [{ itemId: itemAId, variantSku: "", qty: 1, reason: "UNSOLD" }],
    });
    unreceivedReturnId = unreceived.returnId;

    const unreceivedLines = await prisma.fieldReturnLine.findMany({ where: { returnId: seededId(unreceivedReturnId) } });
    unreceivedLineId = unreceivedLines[0]!.id;
  });

  afterEach(async () => {
    await prisma.fieldReturnResolution.deleteMany({
      where: { lineId: { in: [seededId(shortLineId), seededId(cleanLineId), seededId(unreceivedLineId)] } },
    });
    await prisma.fieldReturnLine.deleteMany({
      where: { returnId: { in: [seededId(returnId), seededId(unreceivedReturnId)] } },
    });
    await prisma.fieldReturn.deleteMany({
      where: { id: { in: [seededId(returnId), seededId(unreceivedReturnId)] } },
    });
    await prisma.store.delete({ where: { id: seededId(storeId) } });
    await prisma.item.deleteMany({ where: { id: { in: [seededId(itemAId), seededId(itemBId)] } } });
    await prisma.uOM.delete({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(raisedById), seededId(adminId)] } } });
  });

  it("SALESMAN_BEARS settles the line and moves the retur to PENDING_APPROVAL", async () => {
    const res = await resolveFieldReturnLine({ lineId: shortLineId, type: "SALESMAN_BEARS", createdById: adminId });
    expect(res.returnStatus).toBe("PENDING_APPROVAL");
  });

  it("INVESTIGATE does NOT settle — the retur stays in mismatch", async () => {
    const res = await resolveFieldReturnLine({ lineId: shortLineId, type: "INVESTIGATE", note: "cek ke toko", createdById: adminId });
    expect(res.returnStatus).toBe("MISMATCH_PENDING_RESOLUTION");
  });

  it("records the variance in units on the resolution", async () => {
    await resolveFieldReturnLine({ lineId: shortLineId, type: "WRITE_OFF", createdById: adminId });
    const r = await prisma.fieldReturnResolution.findFirstOrThrow({ where: { lineId: seededId(shortLineId) } });
    expect(r.qty).toBe(2); /* claimed 3, received 1 */
    expect(r.type).toBe("WRITE_OFF");
  });

  it("amending APPENDS rather than mutating, and the latest wins", async () => {
    await resolveFieldReturnLine({ lineId: shortLineId, type: "INVESTIGATE", createdById: adminId });
    const res = await resolveFieldReturnLine({ lineId: shortLineId, type: "SALESMAN_BEARS", createdById: adminId });
    expect(res.returnStatus).toBe("PENDING_APPROVAL");
    const all = await prisma.fieldReturnResolution.findMany({ where: { lineId: seededId(shortLineId) } });
    expect(all).toHaveLength(2);
  });

  it("refuses to resolve a line with no variance", async () => {
    await expect(resolveFieldReturnLine({ lineId: cleanLineId, type: "SALESMAN_BEARS", createdById: adminId }))
      .rejects.toMatchObject({ code: "NO_VARIANCE" });
  });

  it("refuses to resolve before the retur has been received", async () => {
    await expect(resolveFieldReturnLine({ lineId: unreceivedLineId, type: "WRITE_OFF", createdById: adminId }))
      .rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("refuses a lineId that does not exist", async () => {
    /* Syntactically cuid-shaped but never seeded — must not be created and then deleted. */
    const unseededLineId = "clnonexistentlineid0000000000";
    await expect(resolveFieldReturnLine({ lineId: unseededLineId, type: "WRITE_OFF", createdById: adminId }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("amending a settled line back to INVESTIGATE reopens the retur to MISMATCH_PENDING_RESOLUTION", async () => {
    await resolveFieldReturnLine({ lineId: shortLineId, type: "SALESMAN_BEARS", createdById: adminId });
    const res = await resolveFieldReturnLine({ lineId: shortLineId, type: "INVESTIGATE", createdById: adminId });
    expect(res.returnStatus).toBe("MISMATCH_PENDING_RESOLUTION");
    const row = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(returnId) } });
    expect(row.status).toBe("MISMATCH_PENDING_RESOLUTION");
  });
});
