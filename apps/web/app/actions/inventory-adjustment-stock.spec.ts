import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

const { session, mockAuth } = vi.hoisted(() => {
  const session = { userId: "", permissions: ["inventory:manage"] as string[] };
  return {
    session,
    mockAuth: vi.fn(async () => ({
      user: { id: session.userId, email: "adjust@test.local", permissions: session.permissions },
    })),
  };
});

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/security/pin", () => ({
  verifyPin: vi.fn(async (id: string) => ({ success: true, userId: id })),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/app/actions/notifications", () => ({ notifyStockAdjustmentCreated: vi.fn() }));
vi.mock("@/lib/notifications/actor-name", () => ({ getActorName: vi.fn(async () => "Test") }));

import { createStockAdjustment } from "./inventory";

/**
 * createStockAdjustment against the real test bed: the pinned balance write and the ledger entry
 * the mover appends. @elorae/db is deliberately not mocked. Never run against prod.
 */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("createStockAdjustment stock and ledger writes (test bed only)", () => {
  let userId = "";
  let uomId = "";
  let itemId = "";
  let rowId = "";

  beforeEach(async () => {
    userId = "";
    uomId = "";
    itemId = "";
    rowId = "";
    session.userId = "";
    session.permissions = ["inventory:manage"];

    const token = Math.floor(Math.random() * 1_000_000_000).toString();
    const user = await prisma.user.create({
      data: { email: `test-adjstock-${token}@test.local`, name: "Test Adjuster" },
    });
    userId = user.id;
    session.userId = userId;
    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-ADJ${token}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `TEST-ADJ-${token}`, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId },
    });
    itemId = item.id;
    const row = await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 10, reservedQty: 0, avgCost: 2000, totalValue: 20_000 },
    });
    rowId = row.id;
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
    let adjustmentIds: string[] = [];
    await step("read adjustments", async () => {
      const rows = await prisma.stockAdjustment.findMany({
        where: { itemId: seededId(itemId) },
        select: { id: true },
      });
      adjustmentIds = rows.map((r) => r.id);
    });
    await step("audit log", () =>
      prisma.auditLog.deleteMany({
        where: { entityType: "StockAdjustment", entityId: { in: adjustmentIds } },
      }),
    );
    await step("ledger", () => prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } }));
    await step("adjustments", () => prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } }));
    await step("inventory", () => prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } }));
    await step("item", () => prisma.item.deleteMany({ where: { id: seededId(itemId) } }));
    await step("uom", () => prisma.uOM.deleteMany({ where: { id: seededId(uomId) } }));
    await step("user", () => prisma.user.deleteMany({ where: { id: seededId(userId) } }));
    if (failures.length) throw new Error(`stock adjustment spec teardown failed — ${failures.join(" | ")}`);
  });

  const adjust = (type: "POSITIVE" | "NEGATIVE", qty: number) =>
    createStockAdjustment({ itemId, type, qty, reason: "Test adjust" }, "000000", userId);

  it("adds to the pinned null-variant row and appends an IN entry", async () => {
    const adjustment = await adjust("POSITIVE", 5);

    expect(Number(adjustment.prevQty)).toBe(10);
    expect(Number(adjustment.newQty)).toBe(15);

    const rows = await prisma.inventoryValue.findMany({ where: { itemId: seededId(itemId) } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(rowId);
    expect(Number(rows[0].qtyOnHand)).toBe(15);
    expect(Number(rows[0].totalValue)).toBe(30_000);

    const ledger = await prisma.stockLedgerEntry.findMany({ where: { itemId: seededId(itemId) } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].refType).toBe("StockAdjustment");
    expect(ledger[0].refId).toBe(adjustment.id);
    expect(ledger[0].type).toBe("IN");
    expect(Number(ledger[0].qty)).toBe(5);
    expect(Number(ledger[0].balanceQty)).toBe(15);
    expect(Number(ledger[0].totalCost)).toBe(10_000);
    expect(Number(ledger[0].balanceValue)).toBe(30_000);
  });

  it("subtracts from the row and appends an OUT entry", async () => {
    const adjustment = await adjust("NEGATIVE", 4);

    const rows = await prisma.inventoryValue.findMany({ where: { itemId: seededId(itemId) } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(rowId);
    expect(Number(rows[0].qtyOnHand)).toBe(6);
    expect(Number(rows[0].totalValue)).toBe(12_000);

    const ledger = await prisma.stockLedgerEntry.findMany({ where: { itemId: seededId(itemId) } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].refId).toBe(adjustment.id);
    expect(ledger[0].type).toBe("OUT");
    expect(Number(ledger[0].qty)).toBe(-4);
    expect(Number(ledger[0].balanceQty)).toBe(6);
    expect(Number(ledger[0].totalCost)).toBe(-8000);
    expect(Number(ledger[0].balanceValue)).toBe(12_000);
  });

  it("refuses an adjustment that would go negative and writes nothing", async () => {
    await expect(adjust("NEGATIVE", 11)).rejects.toThrow(/negative stock/);

    const row = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: rowId } });
    expect(Number(row.qtyOnHand)).toBe(10);
    expect(await prisma.stockAdjustment.count({ where: { itemId: seededId(itemId) } })).toBe(0);
    expect(await prisma.stockLedgerEntry.count({ where: { itemId: seededId(itemId) } })).toBe(0);
  });

  it("refuses a caller without inventory:manage and writes nothing", async () => {
    session.permissions = [];

    await expect(adjust("POSITIVE", 5)).rejects.toThrow();

    const row = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: rowId } });
    expect(Number(row.qtyOnHand)).toBe(10);
    expect(await prisma.stockAdjustment.count({ where: { itemId: seededId(itemId) } })).toBe(0);
    expect(await prisma.stockLedgerEntry.count({ where: { itemId: seededId(itemId) } })).toBe(0);
  });
});
