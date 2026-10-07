import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { freezeFabricRollSnapshot, syncFabricAggregateQty } from "./opname-snapshot";

/**
 * Covers the fabric aggregate sync and the fabric roll snapshot against the real test bed: the
 * set mover's balance and ledger writes, the provisioning branch, and the roll filter. Never run
 * against prod.
 */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("fabric opname snapshot and aggregate sync (test bed only)", () => {
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

    token = Math.floor(Math.random() * 1_000_000_000).toString();

    const user = await prisma.user.create({
      data: { email: `test-opnfab-${token}@test.local`, name: "Test Admin" },
    });
    userId = user.id;
    const st = await prisma.supplierType.create({ data: { code: `ST-OPNFAB${token}`, name: "Test Type" } });
    supplierTypeId = st.id;
    const supplier = await prisma.supplier.create({
      data: { code: `SUP-OPNFAB${token}`, name: "Test Supplier", typeId: supplierTypeId },
    });
    supplierId = supplier.id;
    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-OPNFAB${token}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `TEST-OPNFAB-${token}`, nameId: "test", nameEn: "test", type: "FABRIC", isActive: true, uomId },
    });
    itemId = item.id;
    const grn = await prisma.gRN.create({
      data: { docNumber: `GRN-OPNFAB-${token}`, supplierId, receivedBy: userId, totalAmount: 0, items: [] },
      select: { id: true },
    });
    grnId = grn.id;

    const r1 = await prisma.fabricRoll.create({
      data: { grnId, itemId, rollCode: `OF1-${token}`, rollRef: "R1", initialLength: 10, remainingLength: 10, uomId },
      select: { id: true },
    });
    r1Id = r1.id;
    const r2 = await prisma.fabricRoll.create({
      data: { grnId, itemId, rollCode: `OF2-${token}`, rollRef: "R2", initialLength: 8, remainingLength: 8, uomId },
      select: { id: true },
    });
    r2Id = r2.id;
    const r3 = await prisma.fabricRoll.create({
      data: {
        grnId,
        itemId,
        rollCode: `OF3-${token}`,
        rollRef: "R3",
        initialLength: 5,
        remainingLength: 5,
        isClosed: true,
        uomId,
      },
      select: { id: true },
    });
    r3Id = r3.id;

    const opname = await prisma.stockOpname.create({
      data: { docNumber: `OPN-OPNFAB-${token}`, scope: "FABRIC", status: "CREATED", snapshotAt: new Date(), createdById: userId },
      select: { id: true },
    });
    opnameId = opname.id;
  });

  afterEach(async () => {
    const failures: string[] = [];
    const step = async (what: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        failures.push(`${what}: ${String(e)}`);
      }
    };
    await step("opname rolls", () => prisma.stockOpnameRoll.deleteMany({ where: { opnameId: seededId(opnameId) } }));
    await step("ledger", () => prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } }));
    await step("inventory", () => prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } }));
    await step("rolls", () =>
      prisma.fabricRoll.deleteMany({ where: { id: { in: [r1Id, r2Id, r3Id].map(seededId) } } }),
    );
    await step("grn", () => prisma.gRN.deleteMany({ where: { id: seededId(grnId) } }));
    await step("opname", () => prisma.stockOpname.deleteMany({ where: { id: seededId(opnameId) } }));
    await step("item", () => prisma.item.deleteMany({ where: { id: seededId(itemId) } }));
    await step("uom", () => prisma.uOM.deleteMany({ where: { id: seededId(uomId) } }));
    await step("supplier", () => prisma.supplier.deleteMany({ where: { id: seededId(supplierId) } }));
    await step("supplier type", () => prisma.supplierType.deleteMany({ where: { id: seededId(supplierTypeId) } }));
    await step("user", () => prisma.user.deleteMany({ where: { id: seededId(userId) } }));
    if (failures.length) throw new Error(`fabric opname snapshot spec teardown failed — ${failures.join(" | ")}`);
  });

  const sync = () =>
    prisma.$transaction((tx) =>
      syncFabricAggregateQty(tx, itemId, { refId: `opn-${token}`, refDocNumber: `OPN-${token}` }),
    );

  describe("syncFabricAggregateQty", () => {
    it("sets an existing row to the open-roll total and appends one ADJUSTMENT entry", async () => {
      const seeded = await prisma.inventoryValue.create({
        data: { itemId, variantSku: null, qtyOnHand: 30, reservedQty: 0, avgCost: 1000, totalValue: 30_000 },
      });

      expect(await sync()).toBe(18);

      const rows = await prisma.inventoryValue.findMany({ where: { itemId: seededId(itemId) } });
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(seeded.id);
      expect(Number(rows[0].qtyOnHand)).toBe(18);
      expect(Number(rows[0].totalValue)).toBe(18_000);

      const ledger = await prisma.stockLedgerEntry.findMany({ where: { itemId: seededId(itemId) } });
      expect(ledger).toHaveLength(1);
      expect(ledger[0].type).toBe("ADJUSTMENT");
      expect(ledger[0].refType).toBe("StockOpname");
      expect(ledger[0].refId).toBe(`opn-${token}`);
      expect(Number(ledger[0].qty)).toBe(-12);
      expect(Number(ledger[0].balanceQty)).toBe(18);
      expect(Number(ledger[0].totalCost)).toBe(-12_000);
      expect(Number(ledger[0].balanceValue)).toBe(18_000);
    });

    it("returns the total and writes no ledger entry when the count did not move", async () => {
      await prisma.inventoryValue.create({
        data: { itemId, variantSku: null, qtyOnHand: 18, reservedQty: 0, avgCost: 1000, totalValue: 18_000 },
      });

      expect(await sync()).toBe(18);

      expect(await prisma.stockLedgerEntry.count({ where: { itemId: seededId(itemId) } })).toBe(0);
      const rows = await prisma.inventoryValue.findMany({ where: { itemId: seededId(itemId) } });
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].qtyOnHand)).toBe(18);
    });

    it("provisions a row at the open-roll total with an explicit zero-cost OPENING entry when none exists", async () => {
      expect(await sync()).toBe(18);

      const rows = await prisma.inventoryValue.findMany({ where: { itemId: seededId(itemId) } });
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].qtyOnHand)).toBe(18);
      expect(Number(rows[0].avgCost)).toBe(0);
      expect(Number(rows[0].totalValue)).toBe(0);

      const ledger = await prisma.stockLedgerEntry.findMany({ where: { itemId: seededId(itemId) } });
      expect(ledger).toHaveLength(1);
      expect(ledger[0].type).toBe("OPENING");
      expect(Number(ledger[0].qty)).toBe(18);
      expect(Number(ledger[0].balanceQty)).toBe(18);
      expect(ledger[0].totalCost).not.toBeNull();
      expect(Number(ledger[0].totalCost)).toBe(0);
      expect(ledger[0].balanceValue).not.toBeNull();
      expect(Number(ledger[0].balanceValue)).toBe(0);
    });

    it("returns 0 and writes neither a row nor a ledger entry when no row exists and every roll is closed", async () => {
      await prisma.fabricRoll.updateMany({
        where: { id: { in: [r1Id, r2Id, r3Id].map(seededId) } },
        data: { isClosed: true },
      });

      expect(await sync()).toBe(0);

      expect(await prisma.inventoryValue.count({ where: { itemId: seededId(itemId) } })).toBe(0);
      expect(await prisma.stockLedgerEntry.count({ where: { itemId: seededId(itemId) } })).toBe(0);
    });
  });

  describe("freezeFabricRollSnapshot", () => {
    it("snapshots only the open rolls of the named items", async () => {
      const count = await prisma.$transaction((tx) => freezeFabricRollSnapshot(tx, opnameId, [itemId]));
      expect(count).toBe(2);

      const rows = await prisma.stockOpnameRoll.findMany({ where: { opnameId: seededId(opnameId) } });
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.fabricRollId).sort()).toEqual([r1Id, r2Id].sort());
      expect(rows.map((r) => Number(r.snapshotLength)).sort((a, b) => a - b)).toEqual([8, 10]);
      expect(rows.some((r) => r.fabricRollId === r3Id)).toBe(false);
    });

    it("freezes nothing when itemIds is an empty selection", async () => {
      const count = await prisma.$transaction((tx) => freezeFabricRollSnapshot(tx, opnameId, []));
      expect(count).toBe(0);
      expect(await prisma.stockOpnameRoll.count({ where: { opnameId: seededId(opnameId) } })).toBe(0);
    });
  });
});
