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

d("resolveFieldReturnLine — multiple discrepant lines (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemXId = "";
  let itemYId = "";
  let storeId = "";
  let raisedById = "";
  let adminId = "";
  let returnId = "";
  let lineXId = "";
  let lineYId = "";

  beforeEach(async () => {
    uomId = "";
    itemXId = "";
    itemYId = "";
    storeId = "";
    raisedById = "";
    adminId = "";
    returnId = "";
    lineXId = "";
    lineYId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-FRSM-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const itemX = await prisma.item.create({
      data: { sku: `TEST-FRSM-X-${token}`, nameId: "Retur resolve item X", nameEn: "Retur resolve item X", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    itemXId = itemX.id;

    const itemY = await prisma.item.create({
      data: { sku: `TEST-FRSM-Y-${token}`, nameId: "Retur resolve item Y", nameEn: "Retur resolve item Y", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    itemYId = itemY.id;

    const store = await prisma.store.create({
      data: { code: `TEST-FRSM-STORE-${token}`, name: "Test Retur Resolve Multi Store", address: "Test address", termsType: "PUTUS", isActive: true },
    });
    storeId = store.id;

    const raisedBy = await prisma.user.create({ data: { email: `test-frsm-${token}@example.com`, name: "Test Retur Salesman" } });
    raisedById = raisedBy.id;

    const admin = await prisma.user.create({ data: { email: `test-frsm-admin-${token}@example.com`, name: "Test Warehouse Admin" } });
    adminId = admin.id;

    /* Both lines are short — the retur has TWO discrepant lines, not just one. */
    const created = await createFieldReturn({
      storeId,
      raisedById,
      transport: "SELF_CARRY",
      notaPhotoUrl: "https://cdn.example/nota.jpg",
      notaPhotoR2Key: "field-returns/x/nota.jpg",
      lines: [
        { itemId: itemXId, variantSku: "", qty: 3, reason: "DAMAGED" },
        { itemId: itemYId, variantSku: "", qty: 2, reason: "UNSOLD" },
      ],
    });
    returnId = created.returnId;

    const lines = await prisma.fieldReturnLine.findMany({ where: { returnId: seededId(returnId) } });
    lineXId = lines.find((l) => l.itemId === itemXId)!.id;
    lineYId = lines.find((l) => l.itemId === itemYId)!.id;

    await receiveFieldReturn({
      returnId,
      receivedById: adminId,
      counts: [
        { lineId: lineXId, receivedQty: 1, sellableQty: 1, rejectedQty: 0 },
        { lineId: lineYId, receivedQty: 0, sellableQty: 0, rejectedQty: 0 },
      ],
    });
  });

  afterEach(async () => {
    await prisma.fieldReturnResolution.deleteMany({
      where: { lineId: { in: [seededId(lineXId), seededId(lineYId)] } },
    });
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: seededId(returnId) } });
    await prisma.fieldReturn.delete({ where: { id: seededId(returnId) } });
    await prisma.store.delete({ where: { id: seededId(storeId) } });
    await prisma.item.deleteMany({ where: { id: { in: [seededId(itemXId), seededId(itemYId)] } } });
    await prisma.uOM.delete({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(raisedById), seededId(adminId)] } } });
  });

  it("both discrepant lines must settle before the retur reaches PENDING_APPROVAL", async () => {
    const first = await resolveFieldReturnLine({ lineId: lineXId, type: "SALESMAN_BEARS", createdById: adminId });
    expect(first.returnStatus).toBe("MISMATCH_PENDING_RESOLUTION");

    const second = await resolveFieldReturnLine({ lineId: lineYId, type: "SALESMAN_BEARS", createdById: adminId });
    expect(second.returnStatus).toBe("PENDING_APPROVAL");
  });
});

d("resolveFieldReturnLine — surplus (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let raisedById = "";
  let adminId = "";
  let returnId = "";
  let lineId = "";

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    storeId = "";
    raisedById = "";
    adminId = "";
    returnId = "";
    lineId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-FRSS-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-FRSS-${token}`, nameId: "Retur resolve item surplus", nameEn: "Retur resolve item surplus", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    itemId = item.id;

    const store = await prisma.store.create({
      data: { code: `TEST-FRSS-STORE-${token}`, name: "Test Retur Resolve Surplus Store", address: "Test address", termsType: "PUTUS", isActive: true },
    });
    storeId = store.id;

    const raisedBy = await prisma.user.create({ data: { email: `test-frss-${token}@example.com`, name: "Test Retur Salesman" } });
    raisedById = raisedBy.id;

    const admin = await prisma.user.create({ data: { email: `test-frss-admin-${token}@example.com`, name: "Test Warehouse Admin" } });
    adminId = admin.id;

    /* Claimed 2, actually delivered 5 — the store sent back more than it claimed. */
    const created = await createFieldReturn({
      storeId,
      raisedById,
      transport: "SELF_CARRY",
      notaPhotoUrl: "https://cdn.example/nota.jpg",
      notaPhotoR2Key: "field-returns/x/nota.jpg",
      lines: [{ itemId, variantSku: "", qty: 2, reason: "UNSOLD" }],
    });
    returnId = created.returnId;

    const lines = await prisma.fieldReturnLine.findMany({ where: { returnId: seededId(returnId) } });
    lineId = lines[0]!.id;

    await receiveFieldReturn({
      returnId,
      receivedById: adminId,
      counts: [{ lineId, receivedQty: 5, sellableQty: 5, rejectedQty: 0 }],
    });
  });

  afterEach(async () => {
    await prisma.fieldReturnResolution.deleteMany({ where: { lineId: seededId(lineId) } });
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: seededId(returnId) } });
    await prisma.fieldReturn.delete({ where: { id: seededId(returnId) } });
    await prisma.store.delete({ where: { id: seededId(storeId) } });
    await prisma.item.delete({ where: { id: seededId(itemId) } });
    await prisma.uOM.delete({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(raisedById), seededId(adminId)] } } });
  });

  it("ACCEPT_SURPLUS settles a surplus line — the variance guard is `!== 0`, not `< 0`", async () => {
    const res = await resolveFieldReturnLine({ lineId, type: "ACCEPT_SURPLUS", createdById: adminId });
    expect(res.returnStatus).toBe("PENDING_APPROVAL");
    const r = await prisma.fieldReturnResolution.findFirstOrThrow({ where: { lineId: seededId(lineId) } });
    expect(r.qty).toBe(3); /* claimed 2, received 5 */
    expect(r.type).toBe("ACCEPT_SURPLUS");
  });
});
