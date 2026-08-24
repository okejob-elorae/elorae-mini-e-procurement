import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createFieldReturn } from "./writer";
import { receiveFieldReturn } from "./receive-writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("receiveFieldReturn (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemAId = "";
  let itemBId = "";
  let storeId = "";
  let raisedById = "";
  let adminId = "";
  let returnId = "";
  let lineAId = "";
  let lineBId = "";

  const cleanCounts = () => [
    { lineId: lineAId, receivedQty: 3, sellableQty: 3, rejectedQty: 0 },
    { lineId: lineBId, receivedQty: 2, sellableQty: 2, rejectedQty: 0 },
  ];

  beforeEach(async () => {
    uomId = "";
    itemAId = "";
    itemBId = "";
    storeId = "";
    raisedById = "";
    adminId = "";
    returnId = "";
    lineAId = "";
    lineBId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-FRR-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const itemA = await prisma.item.create({
      data: { sku: `TEST-FRR-A-${token}`, nameId: "Retur item A", nameEn: "Retur item A", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    itemAId = itemA.id;

    const itemB = await prisma.item.create({
      data: { sku: `TEST-FRR-B-${token}`, nameId: "Retur item B", nameEn: "Retur item B", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    itemBId = itemB.id;

    const store = await prisma.store.create({
      data: { code: `TEST-FRR-STORE-${token}`, name: "Test Retur Receiving Store", address: "Test address", termsType: "PUTUS", isActive: true },
    });
    storeId = store.id;

    const raisedBy = await prisma.user.create({ data: { email: `test-frr-${token}@example.com`, name: "Test Retur Salesman" } });
    raisedById = raisedBy.id;

    const admin = await prisma.user.create({ data: { email: `test-frr-admin-${token}@example.com`, name: "Test Warehouse Admin" } });
    adminId = admin.id;

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
    lineAId = lines.find((l) => l.itemId === itemAId)!.id;
    lineBId = lines.find((l) => l.itemId === itemBId)!.id;
  });

  afterEach(async () => {
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: seededId(returnId) } });
    await prisma.fieldReturn.delete({ where: { id: seededId(returnId) } });
    await prisma.store.delete({ where: { id: seededId(storeId) } });
    await prisma.item.deleteMany({ where: { id: { in: [seededId(itemAId), seededId(itemBId)] } } });
    await prisma.uOM.delete({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(raisedById), seededId(adminId)] } } });
  });

  it("a clean count lands PENDING_APPROVAL", async () => {
    const res = await receiveFieldReturn({
      returnId,
      receivedById: adminId,
      counts: [
        { lineId: lineAId, receivedQty: 3, sellableQty: 3, rejectedQty: 0 },
        { lineId: lineBId, receivedQty: 2, sellableQty: 2, rejectedQty: 0 },
      ],
    });
    expect(res.status).toBe("PENDING_APPROVAL");
    const row = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(returnId) } });
    expect(row.status).toBe("PENDING_APPROVAL");
    expect(row.receivedById).toBe(adminId);
    expect(row.receivedAt).not.toBeNull();
  });

  it("a short line lands MISMATCH_PENDING_RESOLUTION", async () => {
    const res = await receiveFieldReturn({
      returnId,
      receivedById: adminId,
      counts: [
        { lineId: lineAId, receivedQty: 1, sellableQty: 1, rejectedQty: 0 },
        { lineId: lineBId, receivedQty: 2, sellableQty: 2, rejectedQty: 0 },
      ],
    });
    expect(res.status).toBe("MISMATCH_PENDING_RESOLUTION");
  });

  it("an OVER line lands MISMATCH_PENDING_RESOLUTION", async () => {
    const res = await receiveFieldReturn({
      returnId,
      receivedById: adminId,
      counts: [
        { lineId: lineAId, receivedQty: 5, sellableQty: 5, rejectedQty: 0 },
        { lineId: lineBId, receivedQty: 2, sellableQty: 2, rejectedQty: 0 },
      ],
    });
    expect(res.status).toBe("MISMATCH_PENDING_RESOLUTION");
  });

  it("accepts an ALL-ZERO count — the lost-sack case", async () => {
    const res = await receiveFieldReturn({
      returnId,
      receivedById: adminId,
      counts: [
        { lineId: lineAId, receivedQty: 0, sellableQty: 0, rejectedQty: 0 },
        { lineId: lineBId, receivedQty: 0, sellableQty: 0, rejectedQty: 0 },
      ],
    });
    expect(res.status).toBe("MISMATCH_PENDING_RESOLUTION");
    const lines = await prisma.fieldReturnLine.findMany({ where: { returnId: seededId(returnId) } });
    expect(lines.every((l) => l.receivedQty === 0)).toBe(true);
  });

  it("records the sellable/rejected split per line", async () => {
    await receiveFieldReturn({
      returnId,
      receivedById: adminId,
      counts: [
        { lineId: lineAId, receivedQty: 3, sellableQty: 1, rejectedQty: 2 },
        { lineId: lineBId, receivedQty: 2, sellableQty: 2, rejectedQty: 0 },
      ],
    });
    const a = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(lineAId) } });
    expect(a.sellableQty).toBe(1);
    expect(a.rejectedQty).toBe(2);
  });

  it("refuses a split that does not sum to received", async () => {
    await expect(receiveFieldReturn({
      returnId,
      receivedById: adminId,
      counts: [
        { lineId: lineAId, receivedQty: 3, sellableQty: 1, rejectedQty: 1 },
        { lineId: lineBId, receivedQty: 2, sellableQty: 2, rejectedQty: 0 },
      ],
    })).rejects.toMatchObject({ code: "SPLIT_MISMATCH" });
    const a = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(lineAId) } });
    expect(a.receivedQty).toBeNull();
  });

  it("refuses a count that omits a line", async () => {
    await expect(receiveFieldReturn({
      returnId,
      receivedById: adminId,
      counts: [{ lineId: lineAId, receivedQty: 3, sellableQty: 3, rejectedQty: 0 }],
    })).rejects.toMatchObject({ code: "MISSING_LINE" });
  });

  it("refuses a count with a lineId not on the retur", async () => {
    await expect(receiveFieldReturn({
      returnId,
      receivedById: adminId,
      counts: [
        { lineId: lineAId, receivedQty: 3, sellableQty: 3, rejectedQty: 0 },
        { lineId: lineBId, receivedQty: 2, sellableQty: 2, rejectedQty: 0 },
        { lineId: "does-not-exist", receivedQty: 0, sellableQty: 0, rejectedQty: 0 },
      ],
    })).rejects.toMatchObject({ code: "UNKNOWN_LINE" });
  });

  it("refuses receiving twice", async () => {
    await receiveFieldReturn({ returnId, receivedById: adminId, counts: cleanCounts() });
    await expect(receiveFieldReturn({ returnId, receivedById: adminId, counts: cleanCounts() }))
      .rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});
