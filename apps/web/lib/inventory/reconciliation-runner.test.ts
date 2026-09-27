import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/internal-api", () => ({
  apiFetch: vi.fn(),
}));

import { prisma, seededId } from "@elorae/db";
import { apiFetch } from "@/lib/internal-api";
import { resolveReconciliationItem, updateReconciliationSettings } from "./reconciliation-runner";

/*
 * Exercises resolveReconciliationItem's MATCH_JUBELIO path against the real DB, with the live
 * Jubelio re-fetch (apiFetch) mocked per test. Never run against the shared prod DB (port 3307
 * tunnel / VPS host).
 */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

type Fixture = {
  itemId: string;
  runId: string;
  resultId: string;
  jubelioItemGroupId: number;
  jubelioItemId: number;
};

d("resolveReconciliationItem MATCH_JUBELIO (test bed only)", () => {
  let uomId = "";
  const itemIds: string[] = [];
  const runIds: string[] = [];
  const resultIds: string[] = [];
  let nextJubelioId = Math.floor(Math.random() * 1_000_000) + 1;

  beforeEach(async () => {
    /* Unset before seeding, so a throw mid-hook leaves teardown scoped to what this run created. */
    uomId = "";
    itemIds.length = 0;
    runIds.length = 0;
    resultIds.length = 0;
    vi.clearAllMocks();

    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-RECON-${nextJubelioId}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;
  });

  afterEach(async () => {
    for (const resultId of resultIds) {
      await prisma.reconciliationResult.deleteMany({ where: { id: seededId(resultId) } });
    }
    for (const runId of runIds) {
      await prisma.reconciliationRun.deleteMany({ where: { id: seededId(runId) } });
    }
    for (const itemId of itemIds) {
      await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.jubelioProductMapping.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    }
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  async function seedFixture(opts: {
    qtyOnHand: number;
    eloraeQty: number;
    jubelioQty: number;
  }): Promise<Fixture> {
    const token = Math.random().toString(36).slice(2, 10);
    const item = await prisma.item.create({
      data: {
        sku: `TEST-RECON-${token}`,
        nameId: "test",
        nameEn: "test",
        type: "FINISHED_GOOD",
        isActive: true,
        uomId,
      },
    });
    itemIds.push(item.id);

    await prisma.inventoryValue.create({
      data: {
        itemId: item.id,
        variantSku: "",
        qtyOnHand: opts.qtyOnHand,
        avgCost: 10,
        totalValue: opts.qtyOnHand * 10,
      },
    });

    const jubelioItemGroupId = nextJubelioId++;
    const jubelioItemId = nextJubelioId++;
    await prisma.jubelioProductMapping.create({
      data: {
        itemId: item.id,
        jubelioItemGroupId,
        jubelioItemId,
        jubelioItemCode: `TEST-JCODE-${token}`,
        erpVariantSku: "",
      },
    });

    const run = await prisma.reconciliationRun.create({
      data: { triggeredBy: "MANUAL", status: "COMPLETED" },
    });
    runIds.push(run.id);

    const result = await prisma.reconciliationResult.create({
      data: {
        runId: run.id,
        itemId: item.id,
        variantSku: null,
        itemName: "Test Item",
        jubelioItemId,
        eloraeQty: opts.eloraeQty,
        jubelioQty: opts.jubelioQty,
        variance: opts.eloraeQty - opts.jubelioQty,
        action: "FLAGGED",
      },
    });
    resultIds.push(result.id);

    return { itemId: item.id, runId: run.id, resultId: result.id, jubelioItemGroupId, jubelioItemId };
  }

  function mockLiveJubelioQty(fx: Fixture, jubelioQty: number): void {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        rows: [{ itemId: fx.itemId, variantSku: "", jubelioItemId: fx.jubelioItemId, jubelioQty }],
      },
    });
  }

  it("H=10, no offline holds, J=6 -> H=6, with one StockAdjustment and one ledger ADJUSTMENT", async () => {
    const fx = await seedFixture({ qtyOnHand: 10, eloraeQty: 10, jubelioQty: 9 });
    mockLiveJubelioQty(fx, 6);

    const res = await resolveReconciliationItem({ resultId: fx.resultId, direction: "MATCH_JUBELIO", userId: "u1" });
    expect(res).toEqual({ success: true });

    const inv = await prisma.inventoryValue.findFirst({ where: { itemId: fx.itemId } });
    expect(Number(inv!.qtyOnHand)).toBe(6);

    const adjustments = await prisma.stockAdjustment.findMany({ where: { itemId: fx.itemId } });
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].source).toBe("JUBELIO_RECONCILE");
    expect(Number(adjustments[0].prevQty)).toBe(10);
    expect(Number(adjustments[0].newQty)).toBe(6);

    const ledger = await prisma.stockLedgerEntry.findMany({
      where: { itemId: fx.itemId, refType: "Reconciliation" },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].type).toBe("ADJUSTMENT");
    expect(Number(ledger[0].balanceQty)).toBe(6);

    const result = await prisma.reconciliationResult.findUnique({ where: { id: fx.resultId } });
    expect(result!.action).toBe("MANUALLY_RESOLVED");
  });

  it("FIELD_SALES hold 2, J=6 -> H=8", async () => {
    const fx = await seedFixture({ qtyOnHand: 10, eloraeQty: 8, jubelioQty: 6 });
    await prisma.stockReservation.create({
      data: { itemId: fx.itemId, variantSku: "", qty: 2, consumedQty: 0, state: "RESERVED", source: "FIELD_SALES" },
    });
    mockLiveJubelioQty(fx, 6);

    const res = await resolveReconciliationItem({ resultId: fx.resultId, direction: "MATCH_JUBELIO", userId: "u1" });
    expect(res).toEqual({ success: true });

    const inv = await prisma.inventoryValue.findFirst({ where: { itemId: fx.itemId } });
    expect(Number(inv!.qtyOnHand)).toBe(8);
  });

  it("refuses when the live Jubelio quantity is invalid, writing nothing", async () => {
    const fx = await seedFixture({ qtyOnHand: 10, eloraeQty: 10, jubelioQty: 10 });
    mockLiveJubelioQty(fx, -5);

    const res = await resolveReconciliationItem({ resultId: fx.resultId, direction: "MATCH_JUBELIO", userId: "u1" });
    expect(res.success).toBe(false);

    const inv = await prisma.inventoryValue.findFirst({ where: { itemId: fx.itemId } });
    expect(Number(inv!.qtyOnHand)).toBe(10);

    const adjustments = await prisma.stockAdjustment.findMany({ where: { itemId: fx.itemId } });
    expect(adjustments).toHaveLength(0);

    const result = await prisma.reconciliationResult.findUnique({ where: { id: fx.resultId } });
    expect(result!.action).toBe("FLAGGED");
  });

  it("refuses when Elorae's live figure has moved since the run, writing nothing", async () => {
    // Stored eloraeQty (10) no longer matches the live on-hand (now 3) — something moved stock
    // between the run and this resolve.
    const fx = await seedFixture({ qtyOnHand: 3, eloraeQty: 10, jubelioQty: 6 });
    mockLiveJubelioQty(fx, 6);

    const res = await resolveReconciliationItem({ resultId: fx.resultId, direction: "MATCH_JUBELIO", userId: "u1" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/re-run reconciliation/);

    const inv = await prisma.inventoryValue.findFirst({ where: { itemId: fx.itemId } });
    expect(Number(inv!.qtyOnHand)).toBe(3);

    const result = await prisma.reconciliationResult.findUnique({ where: { id: fx.resultId } });
    expect(result!.action).toBe("FLAGGED");
  });

  it("refuses REASSERT_ELORAE while the Jubelio push switch is off, writing and enqueuing nothing", async () => {
    // JUBELIO_STOCK_PUSH_ENABLED_KEY is absent in this test bed by default, so the switch reads
    // disabled (fail-closed) — see isJubelioStockPushEnabled in jubelio-stock-contract.ts.
    const fx = await seedFixture({ qtyOnHand: 10, eloraeQty: 10, jubelioQty: 6 });

    const res = await resolveReconciliationItem({ resultId: fx.resultId, direction: "REASSERT_ELORAE", userId: "u1" });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/disabled until cutover/);
    expect(apiFetch).not.toHaveBeenCalled();

    const outbox = await prisma.jubelioOutbox.findMany({ where: { entityId: fx.itemId } });
    expect(outbox).toHaveLength(0);

    const result = await prisma.reconciliationResult.findUnique({ where: { id: fx.resultId } });
    expect(result!.action).toBe("FLAGGED");
  });
});

d("updateReconciliationSettings gated by the cutover switch (test bed only)", () => {
  const directionKey = "RECON_AUTO_CORRECT_DIRECTION";
  let originalDirection: string | null = null;

  beforeEach(async () => {
    // Snapshot the real dev-bed value (this key drives the live cron) so the refusal test below
    // can restore it exactly rather than deleting whatever an operator had configured.
    const existing = await prisma.systemSetting.findUnique({ where: { key: directionKey } });
    originalDirection = existing?.value ?? null;
  });

  afterEach(async () => {
    if (originalDirection === null) {
      await prisma.systemSetting.deleteMany({ where: { key: directionKey } });
    } else {
      await prisma.systemSetting.upsert({
        where: { key: directionKey },
        update: { value: originalDirection },
        create: { key: directionKey, value: originalDirection },
      });
    }
  });

  it("refuses to save REASSERT_ELORAE as the direction while the switch is off, leaving it unchanged", async () => {
    await expect(updateReconciliationSettings(0, "REASSERT_ELORAE", true)).rejects.toThrow(
      /disabled until cutover/,
    );

    const saved = await prisma.systemSetting.findUnique({ where: { key: directionKey } });
    expect(saved?.value ?? null).toBe(originalDirection);
  });
});
