import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { applyFabricAdjustments } from "./opname-approve";

/* A roll another path closed between an opname's snapshot and its approval must be reopened when fabric was counted on it. Never run against prod. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("opname fabric recount reopens a closed roll (test bed only)", () => {
  let token = "";
  let userId = "";
  let supplierTypeId = "";
  let supplierId = "";
  let uomId = "";
  let itemId = "";
  let grnId = "";
  let opnameId = "";
  let r1Id = "";
  let r2Id = "";
  let r3Id = "";

  beforeEach(async () => {
    /* Unset before seeding, so a throw mid-hook leaves teardown scoped to what this run actually created. */
    token = "";
    userId = "";
    supplierTypeId = "";
    supplierId = "";
    uomId = "";
    itemId = "";
    grnId = "";
    opnameId = "";
    r1Id = "";
    r2Id = "";
    r3Id = "";

    token = Math.floor(Math.random() * 10_000_000).toString();

    const user = await prisma.user.create({
      data: { email: `test-opn-fr-${token}@test.local`, name: "Test Admin" },
    });
    userId = user.id;
    const st = await prisma.supplierType.create({ data: { code: `ST-FR${token}`, name: "Test Type" } });
    supplierTypeId = st.id;
    const supplier = await prisma.supplier.create({
      data: { code: `SUP-FR${token}`, name: "Test Supplier", typeId: supplierTypeId },
    });
    supplierId = supplier.id;
    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-FR${token}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `TEST-FR-${token}`, nameId: "test", nameEn: "test", type: "FABRIC", isActive: true, uomId },
    });
    itemId = item.id;
    const grn = await prisma.gRN.create({
      data: {
        docNumber: `GRN-FR-${token}`,
        supplierId,
        receivedBy: userId,
        totalAmount: 0,
        items: [],
      },
      select: { id: true },
    });
    grnId = grn.id;

    const r1 = await prisma.fabricRoll.create({
      data: { grnId, itemId, rollCode: `FR1-${token}`, rollRef: "R1", initialLength: 10, remainingLength: 10, uomId },
      select: { id: true },
    });
    r1Id = r1.id;
    const r2 = await prisma.fabricRoll.create({
      data: { grnId, itemId, rollCode: `FR2-${token}`, rollRef: "R2", initialLength: 5, remainingLength: 5, uomId },
      select: { id: true },
    });
    r2Id = r2.id;
    const r3 = await prisma.fabricRoll.create({
      data: { grnId, itemId, rollCode: `FR3-${token}`, rollRef: "R3", initialLength: 3, remainingLength: 3, uomId },
      select: { id: true },
    });
    r3Id = r3.id;

    await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 18, reservedQty: 0, avgCost: 1000, totalValue: 18_000 },
    });

    const opname = await prisma.stockOpname.create({
      data: {
        docNumber: `OPN-FR-${token}`,
        scope: "FABRIC",
        status: "CREATED",
        snapshotAt: new Date(),
        createdById: userId,
      },
      select: { id: true },
    });
    opnameId = opname.id;

    await prisma.stockOpnameRoll.createMany({
      data: [
        { opnameId, fabricRollId: r1Id, rollCode: `FR1-${token}`, itemName: "Test", snapshotLength: 10, countedLength: 8 },
        { opnameId, fabricRollId: r2Id, rollCode: `FR2-${token}`, itemName: "Test", snapshotLength: 5, countedLength: 4 },
        { opnameId, fabricRollId: r3Id, rollCode: `FR3-${token}`, itemName: "Test", snapshotLength: 3, countedLength: 0 },
      ],
    });

    /* Simulate another path consuming R2 to zero after the snapshot. */
    await prisma.fabricRoll.update({ where: { id: r2Id }, data: { isClosed: true, remainingLength: 0 } });
  });

  afterEach(async () => {
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockOpnameRoll.deleteMany({ where: { opnameId: seededId(opnameId) } });
    if (opnameId) await prisma.stockOpname.delete({ where: { id: opnameId } });
    await prisma.fabricRoll.deleteMany({ where: { id: { in: [r1Id, r2Id, r3Id].filter(Boolean) } } });
    if (grnId) await prisma.gRN.delete({ where: { id: grnId } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    if (itemId) await prisma.item.delete({ where: { id: itemId } });
    if (uomId) await prisma.uOM.delete({ where: { id: uomId } });
    if (supplierId) await prisma.supplier.delete({ where: { id: supplierId } });
    if (supplierTypeId) await prisma.supplierType.delete({ where: { id: supplierTypeId } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
  });

  it("reopens a roll closed mid-opname when fabric was counted on it, and counts it in the aggregate", async () => {
    const res = await prisma.$transaction((tx) =>
      applyFabricAdjustments(tx, opnameId, `OPN-FR-${token}`),
    );
    expect(res.adjustmentCount).toBe(3);

    const r1 = await prisma.fabricRoll.findUniqueOrThrow({ where: { id: r1Id } });
    expect(Number(r1.remainingLength)).toBe(8);
    expect(r1.isClosed).toBe(false);

    const r2 = await prisma.fabricRoll.findUniqueOrThrow({ where: { id: r2Id } });
    expect(Number(r2.remainingLength)).toBe(4);
    expect(r2.isClosed).toBe(false);

    const r3 = await prisma.fabricRoll.findUniqueOrThrow({ where: { id: r3Id } });
    expect(Number(r3.remainingLength)).toBe(0);
    expect(r3.isClosed).toBe(true);

    const inv = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId } });
    expect(Number(inv.qtyOnHand)).toBe(12);
  });
});
