import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { detectItemDrift, applyFgAccessoriesAdjustments } from "./opname-approve";

// Regression: Jubelio-ingested items store InventoryValue with variantSku = NULL.
// normalizeVariantKey(null) is "", so a strict findUnique on variantSku "" missed the
// NULL row → false drift + silently-skipped adjustments. Never run against prod.
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("opname NULL-variant InventoryValue lookup (test bed only)", () => {
  let token: string;
  let userId: string;
  let uomId: string;
  let itemId: string;
  let opnameId: string;

  beforeEach(async () => {
    token = Math.floor(Math.random() * 10_000_000).toString();

    const user = await prisma.user.create({
      data: { email: `test-opn-nv-${token}@test.local`, name: "Test Admin" },
    });
    userId = user.id;

    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-NV${token}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `TEST-NV-${token}`, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId },
    });
    itemId = item.id;

    // Jubelio-ingested style: InventoryValue keyed with variantSku = NULL (not "").
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 120, reservedQty: 0, avgCost: 20000, totalValue: 2_400_000 },
    });

    const opname = await prisma.stockOpname.create({
      data: {
        docNumber: `OPN-NV-${token}`,
        scope: "FINISHED_GOOD",
        status: "CREATED",
        snapshotAt: new Date(),
        createdById: userId,
      },
      select: { id: true },
    });
    opnameId = opname.id;
  });

  afterEach(async () => {
    await prisma.stockMovement.deleteMany({ where: { refType: "OPNAME", refId: opnameId } });
    await prisma.stockAdjustment.deleteMany({ where: { externalRef: opnameId } });
    await prisma.stockOpnameItem.deleteMany({ where: { opnameId } });
    await prisma.stockOpname.delete({ where: { id: opnameId } });
    await prisma.inventoryValue.deleteMany({ where: { itemId } });
    await prisma.item.delete({ where: { id: itemId } });
    await prisma.uOM.delete({ where: { id: uomId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("detectItemDrift finds the NULL-variant row — no false drift when count matches live qty", async () => {
    // Opname line stored with variantSku NULL, snapshot 120 == live 120 → must NOT flag drift.
    await prisma.stockOpnameItem.create({
      data: { opnameId, itemId, variantSku: null, itemName: "Test", snapshotQty: 120 },
    });
    const drift = await detectItemDrift(prisma, opnameId);
    expect(drift).toHaveLength(0);
  });

  it("applyFgAccessoriesAdjustments applies the count correction for a NULL-variant item", async () => {
    // Count 130 vs live 120 → +10 surplus. Must apply (not skip on a missed lookup).
    await prisma.stockOpnameItem.create({
      data: { opnameId, itemId, variantSku: null, itemName: "Test", snapshotQty: 120, countedQty: 130 },
    });
    const res = await prisma.$transaction((tx) =>
      applyFgAccessoriesAdjustments(tx, opnameId, `OPN-NV-${token}`, userId, "FINISHED_GOOD"),
    );
    expect(res.adjustmentCount).toBe(1);

    const inv = await prisma.inventoryValue.findFirst({ where: { itemId } });
    expect(Number(inv!.qtyOnHand)).toBe(130);

    const mv = await prisma.stockMovement.findFirst({ where: { refType: "OPNAME", refId: opnameId } });
    expect(Number(mv!.totalCost)).toBe(10 * 20000);
  });
});
