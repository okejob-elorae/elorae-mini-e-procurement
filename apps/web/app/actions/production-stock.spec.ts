import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

const { session, mockAuth, docSeq } = vi.hoisted(() => {
  const session = { userId: "", token: "" };
  return {
    session,
    docSeq: { n: 0 },
    mockAuth: vi.fn(async () => ({
      user: { id: session.userId, permissions: ["work_orders:manage"] },
    })),
  };
});

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/docNumber", () => ({
  generateDocNumber: vi.fn(async (type: string) => `TEST-${type}-${session.token}-${++docSeq.n}`),
}));
vi.mock("@/lib/production/planning", () => ({ generateMaterialPlan: vi.fn() }));
vi.mock("@/lib/production/reconciliation", () => ({ reconcileWorkOrder: vi.fn() }));
vi.mock("@/lib/notifications/actor-name", () => ({ getActorName: vi.fn(async () => "Test") }));
vi.mock("@/app/actions/notifications", () => ({
  notifyWOCreated: vi.fn(async () => {}),
  notifyWOStatusUpdated: vi.fn(async () => {}),
  notifyWOMaterialsIssued: vi.fn(async () => {}),
  notifyWOCompleted: vi.fn(async () => {}),
}));
vi.mock("@/app/actions/settings/ppn", () => ({ getPpnRatePercent: vi.fn(async () => 11) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/production/fg-receipt-journal", () => ({
  postFgReceiptJournal: vi.fn(async () => ({ ok: false, code: "NOTHING_TO_POST" })),
}));
vi.mock("@/lib/work-orders/queries", () => ({ listWorkOrders: vi.fn() }));
vi.mock("@/lib/leadtime/wo-snapshot", () => ({ resolveWoLeadTimeFields: vi.fn() }));
vi.mock("@/lib/leadtime/calculations", () => ({ computeActualLeadDays: vi.fn() }));
vi.mock("@/lib/leadtime/auto-confirm", () => ({ applyChainSignal: vi.fn(async () => {}) }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

import { issueMaterials, receiveFG } from "./production";

/**
 * issueMaterials and receiveFG against the real test bed: the per-row draw across the null and
 * "" variantless rows, the FG moving average, and the ledger entries each mover appends.
 * @elorae/db is deliberately not mocked; the document counters are, so shared sequences stay
 * untouched. Never run against prod.
 */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("production stock movement (test bed only)", () => {
  let token = "";
  let userId = "";
  let supplierTypeId = "";
  let vendorId = "";
  let uomId = "";
  let fgItemId = "";
  let rawItemId = "";
  let woId = "";
  let rawNullRowId = "";
  let rawEmptyRowId = "";
  let fgRowId = "";

  beforeEach(async () => {
    token = "";
    userId = "";
    supplierTypeId = "";
    vendorId = "";
    uomId = "";
    fgItemId = "";
    rawItemId = "";
    woId = "";
    rawNullRowId = "";
    rawEmptyRowId = "";
    fgRowId = "";
    session.userId = "";
    session.token = "";

    token = Math.floor(Math.random() * 1_000_000_000).toString();
    session.token = token;

    const user = await prisma.user.create({
      data: { email: `test-prodstock-${token}@test.local`, name: "Test Admin" },
    });
    userId = user.id;
    session.userId = userId;
    const st = await prisma.supplierType.create({ data: { code: `ST-PS${token}`, name: "Test Type" } });
    supplierTypeId = st.id;
    const vendor = await prisma.supplier.create({
      data: { code: `SUP-PS${token}`, name: "Test Vendor", typeId: supplierTypeId },
    });
    vendorId = vendor.id;
    const uom = await prisma.uOM.create({ data: { code: `UOM-PS${token}`, nameId: "t", nameEn: "t" } });
    uomId = uom.id;
    const fg = await prisma.item.create({
      data: { sku: `FG-PS-${token}`, nameId: "t", nameEn: "t", type: "FINISHED_GOOD", isActive: true, uomId },
    });
    fgItemId = fg.id;
    const raw = await prisma.item.create({
      data: { sku: `RAW-PS-${token}`, nameId: "Test raw", nameEn: "Test raw", type: "ACCESSORIES", isActive: true, uomId },
    });
    rawItemId = raw.id;

    const rawNull = await prisma.inventoryValue.create({
      data: { itemId: rawItemId, variantSku: null, qtyOnHand: 4, reservedQty: 0, avgCost: 1000, totalValue: 4000 },
    });
    rawNullRowId = rawNull.id;
    const rawEmpty = await prisma.inventoryValue.create({
      data: { itemId: rawItemId, variantSku: "", qtyOnHand: 10, reservedQty: 0, avgCost: 1500, totalValue: 15_000 },
    });
    rawEmptyRowId = rawEmpty.id;
    const fgRow = await prisma.inventoryValue.create({
      data: { itemId: fgItemId, variantSku: null, qtyOnHand: 10, reservedQty: 0, avgCost: 300, totalValue: 3000 },
    });
    fgRowId = fgRow.id;

    const wo = await prisma.workOrder.create({
      data: {
        docNumber: `WO-PS-${token}`,
        vendorId,
        finishedGoodId: fgItemId,
        plannedQty: 10,
        status: "IN_PRODUCTION",
        outputMode: "GENERIC",
        consumptionPlan: [],
        createdById: userId,
      },
      select: { id: true },
    });
    woId = wo.id;
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
    const itemIds = [fgItemId, rawItemId].map(seededId);
    await step("price change log", () => prisma.itemPriceChangeLog.deleteMany({ where: { itemId: { in: itemIds } } }));
    await step("fg receipts", () => prisma.fGReceipt.deleteMany({ where: { woId: seededId(woId) } }));
    await step("material issues", () => prisma.materialIssue.deleteMany({ where: { woId: seededId(woId) } }));
    await step("work order", () => prisma.workOrder.deleteMany({ where: { id: seededId(woId) } }));
    await step("ledger", () => prisma.stockLedgerEntry.deleteMany({ where: { itemId: { in: itemIds } } }));
    await step("inventory", () => prisma.inventoryValue.deleteMany({ where: { itemId: { in: itemIds } } }));
    await step("fg item", () => prisma.item.deleteMany({ where: { id: seededId(fgItemId) } }));
    await step("raw item", () => prisma.item.deleteMany({ where: { id: seededId(rawItemId) } }));
    await step("uom", () => prisma.uOM.deleteMany({ where: { id: seededId(uomId) } }));
    await step("vendor", () => prisma.supplier.deleteMany({ where: { id: seededId(vendorId) } }));
    await step("supplier type", () => prisma.supplierType.deleteMany({ where: { id: seededId(supplierTypeId) } }));
    await step("user", () => prisma.user.deleteMany({ where: { id: seededId(userId) } }));
    if (failures.length) throw new Error(`production stock spec teardown failed — ${failures.join(" | ")}`);
  });

  const issue = (qty: number) =>
    issueMaterials(
      { woId, items: [{ itemId: rawItemId, qty, uomId }], issueType: "ACCESSORIES", isPartial: false },
      userId,
    );

  const rawQty = async (id: string) => Number((await prisma.inventoryValue.findUniqueOrThrow({ where: { id } })).qtyOnHand);

  describe("issueMaterials", () => {
    it("draws the larger variantless row first, then the other, with one ledger entry per row", async () => {
      const res = await issue(12);

      expect(await rawQty(rawEmptyRowId)).toBe(0);
      expect(await rawQty(rawNullRowId)).toBe(2);
      expect(res.totalCost).toBeCloseTo(17_000, 2);

      const ledger = await prisma.stockLedgerEntry.findMany({
        where: { itemId: seededId(rawItemId) },
        orderBy: { qty: "asc" },
      });
      expect(ledger).toHaveLength(2);
      for (const entry of ledger) {
        expect(entry.refType).toBe("MaterialIssue");
        expect(entry.refId).toBe(res.id);
        expect(entry.type).toBe("OUT");
      }
      expect(Number(ledger[0].qty)).toBe(-10);
      expect(Number(ledger[0].totalCost)).toBe(15_000);
      expect(Number(ledger[0].balanceQty)).toBe(0);
      expect(Number(ledger[1].qty)).toBe(-2);
      expect(Number(ledger[1].totalCost)).toBe(2000);
      expect(Number(ledger[1].balanceQty)).toBe(2);
    });

    it("refuses an issue larger than the total on hand and rolls everything back", async () => {
      await expect(issue(15)).rejects.toThrow(/Stok tidak mencukupi/);

      expect(await rawQty(rawNullRowId)).toBe(4);
      expect(await rawQty(rawEmptyRowId)).toBe(10);
      expect(await prisma.materialIssue.count({ where: { woId: seededId(woId) } })).toBe(0);
      expect(await prisma.stockLedgerEntry.count({ where: { itemId: seededId(rawItemId) } })).toBe(0);
    });

    it("refuses a work order that is already completed and writes nothing", async () => {
      await prisma.workOrder.update({ where: { id: woId }, data: { status: "COMPLETED" } });

      await expect(issue(2)).rejects.toThrow(/tidak valid/);

      expect(await rawQty(rawNullRowId)).toBe(4);
      expect(await rawQty(rawEmptyRowId)).toBe(10);
      expect(await prisma.materialIssue.count({ where: { woId: seededId(woId) } })).toBe(0);
      expect(await prisma.stockLedgerEntry.count({ where: { itemId: seededId(rawItemId) } })).toBe(0);
    });
  });

  describe("receiveFG", () => {
    it("blends the receipt into the FG moving average and appends one FGReceipt entry", async () => {
      await prisma.materialIssue.create({
        data: {
          docNumber: `TEST-ISSUE-SEED-${token}`,
          woId,
          issueType: "ACCESSORIES",
          items: [],
          totalCost: 5000,
          issuedById: userId,
        },
      });

      const receipt = await receiveFG({ woId, qtyReceived: 10, qtyRejected: 0 }, userId);

      const rows = await prisma.inventoryValue.findMany({ where: { itemId: seededId(fgItemId) } });
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(fgRowId);
      expect(Number(rows[0].qtyOnHand)).toBe(20);
      expect(Number(rows[0].avgCost)).toBe(400);
      expect(Number(rows[0].totalValue)).toBe(8000);

      const ledger = await prisma.stockLedgerEntry.findMany({ where: { itemId: seededId(fgItemId) } });
      expect(ledger).toHaveLength(1);
      expect(ledger[0].refType).toBe("FGReceipt");
      expect(ledger[0].refId).toBe(receipt.id);
      expect(Number(ledger[0].qty)).toBe(10);
      expect(Number(ledger[0].balanceQty)).toBe(20);
      expect(Number(ledger[0].totalCost)).toBe(5000);
      expect(Number(ledger[0].balanceValue)).toBe(8000);

      const wo = await prisma.workOrder.findUniqueOrThrow({ where: { id: woId } });
      expect(wo.status).toBe("COMPLETED");
      expect(Number(wo.actualQty)).toBe(10);
    });
  });
});
