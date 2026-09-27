import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/internal-api", () => ({
  apiFetch: vi.fn(),
}));

import { JUBELIO_STOCK_PUSH_ENABLED_KEY, prisma, seededId } from "@elorae/db";
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

/**
 * Snapshots the named SystemSetting keys before each test and puts every one back after it, so
 * these specs never delete or leave behind a value an operator configured on :3308 — the push
 * switch and the RECON_* keys all drive live behaviour there.
 */
function preserveSettings(keys: string[]): void {
  const originals = new Map<string, string | null>();

  beforeEach(async () => {
    originals.clear();
    const rows = await prisma.systemSetting.findMany({ where: { key: { in: keys } } });
    for (const key of keys) {
      originals.set(key, rows.find((r) => r.key === key)?.value ?? null);
    }
  });

  afterEach(async () => {
    for (const key of keys) {
      const original = originals.get(key) ?? null;
      if (original === null) {
        await prisma.systemSetting.deleteMany({ where: { key } });
      } else {
        await prisma.systemSetting.upsert({
          where: { key },
          update: { value: original },
          create: { key, value: original },
        });
      }
    }
  });
}

async function setSetting(key: string, value: string): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

async function setPushSwitch(enabled: boolean): Promise<void> {
  await setSetting(JUBELIO_STOCK_PUSH_ENABLED_KEY, enabled ? "true" : "false");
}

d("resolveReconciliationItem MATCH_JUBELIO (test bed only)", () => {
  let uomId = "";
  const itemIds: string[] = [];
  const runIds: string[] = [];
  const resultIds: string[] = [];
  /* Well above any real Jubelio id, so a fixture mapping never collides with a synced one. */
  let nextJubelioId = Math.floor(Math.random() * 1_000_000) + 900_000_000;

  preserveSettings([JUBELIO_STOCK_PUSH_ENABLED_KEY]);

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

  function mockLiveJubelioQty(fx: Fixture, endQty: number | null): void {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      data: { rows: [{ jubelioItemId: fx.jubelioItemId, endQty }] },
    });
  }

  /* The group id travels in the PATH: a query string fails the signed channel's check. */
  function expectGroupPathFetched(fx: Fixture): void {
    expect(apiFetch).toHaveBeenCalledWith(
      "GET",
      `/jubelio/inventory/snapshot/group/${fx.jubelioItemGroupId}`,
      expect.anything(),
    );
    for (const call of (apiFetch as unknown as ReturnType<typeof vi.fn>).mock.calls) {
      expect(String(call[1])).not.toContain("?");
    }
  }

  async function expectNothingWritten(fx: Fixture, qtyOnHand: number): Promise<void> {
    const inv = await prisma.inventoryValue.findFirst({ where: { itemId: fx.itemId } });
    expect(Number(inv!.qtyOnHand)).toBe(qtyOnHand);
    expect(await prisma.stockAdjustment.count({ where: { itemId: fx.itemId } })).toBe(0);
    expect(await prisma.stockLedgerEntry.count({ where: { itemId: fx.itemId } })).toBe(0);
    const result = await prisma.reconciliationResult.findUnique({ where: { id: fx.resultId } });
    expect(result!.action).toBe("FLAGGED");
  }

  it("H=10, no offline holds, J=6 -> H=6, with one StockAdjustment and one ledger ADJUSTMENT", async () => {
    await setPushSwitch(false);
    const fx = await seedFixture({ qtyOnHand: 10, eloraeQty: 10, jubelioQty: 9 });
    mockLiveJubelioQty(fx, 6);

    const res = await resolveReconciliationItem({ resultId: fx.resultId, direction: "MATCH_JUBELIO", userId: "u1" });
    expect(res).toEqual({ success: true });
    expectGroupPathFetched(fx);

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

  it("switch on: FIELD_SALES hold 2, J=6 -> H=8 (the hold is added back)", async () => {
    await setPushSwitch(true);
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

  it("switch off: FIELD_SALES hold 2, J=6 -> H=6 (no push has netted the hold, so none is added back)", async () => {
    await setPushSwitch(false);
    /* Switch off, so the run compared raw on-hand: eloraeQty = 10, not 10 − 2. */
    const fx = await seedFixture({ qtyOnHand: 10, eloraeQty: 10, jubelioQty: 6 });
    await prisma.stockReservation.create({
      data: { itemId: fx.itemId, variantSku: "", qty: 2, consumedQty: 0, state: "RESERVED", source: "FIELD_SALES" },
    });
    mockLiveJubelioQty(fx, 6);

    const res = await resolveReconciliationItem({ resultId: fx.resultId, direction: "MATCH_JUBELIO", userId: "u1" });
    expect(res).toEqual({ success: true });

    const inv = await prisma.inventoryValue.findFirst({ where: { itemId: fx.itemId } });
    expect(Number(inv!.qtyOnHand)).toBe(6);
  });

  it("refuses JUBELIO_QTY_MISSING when the live group has no row for the variant, writing nothing", async () => {
    await setPushSwitch(false);
    const fx = await seedFixture({ qtyOnHand: 10, eloraeQty: 10, jubelioQty: 0 });
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      data: { rows: [{ jubelioItemId: fx.jubelioItemId + 12345, endQty: 3 }] },
    });

    const res = await resolveReconciliationItem({ resultId: fx.resultId, direction: "MATCH_JUBELIO", userId: "u1" });

    expect(res).toEqual({ success: false, reason: "JUBELIO_QTY_MISSING" });
    await expectNothingWritten(fx, 10);
  });

  it("refuses JUBELIO_QTY_MISSING when the live figure is null, writing nothing", async () => {
    await setPushSwitch(false);
    const fx = await seedFixture({ qtyOnHand: 10, eloraeQty: 10, jubelioQty: 0 });
    mockLiveJubelioQty(fx, null);

    const res = await resolveReconciliationItem({ resultId: fx.resultId, direction: "MATCH_JUBELIO", userId: "u1" });

    expect(res).toEqual({ success: false, reason: "JUBELIO_QTY_MISSING" });
    await expectNothingWritten(fx, 10);
  });

  it("refuses JUBELIO_FETCH_FAILED when the live read fails, writing nothing", async () => {
    await setPushSwitch(false);
    const fx = await seedFixture({ qtyOnHand: 10, eloraeQty: 10, jubelioQty: 6 });
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 502, error: "down" });

    const res = await resolveReconciliationItem({ resultId: fx.resultId, direction: "MATCH_JUBELIO", userId: "u1" });

    expect(res).toEqual({ success: false, reason: "JUBELIO_FETCH_FAILED" });
    await expectNothingWritten(fx, 10);
  });

  it("refuses JUBELIO_QTY_INVALID when the live quantity is invalid, writing nothing", async () => {
    await setPushSwitch(false);
    const fx = await seedFixture({ qtyOnHand: 10, eloraeQty: 10, jubelioQty: 10 });
    mockLiveJubelioQty(fx, -5);

    const res = await resolveReconciliationItem({ resultId: fx.resultId, direction: "MATCH_JUBELIO", userId: "u1" });

    expect(res).toEqual({ success: false, reason: "JUBELIO_QTY_INVALID" });
    await expectNothingWritten(fx, 10);
  });

  it("refuses STOCK_MOVED when Elorae's live figure has moved since the run, writing nothing", async () => {
    await setPushSwitch(false);
    // Stored eloraeQty (10) no longer matches the live on-hand (now 3) — something moved stock
    // between the run and this resolve.
    const fx = await seedFixture({ qtyOnHand: 3, eloraeQty: 10, jubelioQty: 6 });
    mockLiveJubelioQty(fx, 6);

    const res = await resolveReconciliationItem({ resultId: fx.resultId, direction: "MATCH_JUBELIO", userId: "u1" });

    expect(res).toEqual({ success: false, reason: "STOCK_MOVED" });
    await expectNothingWritten(fx, 3);
  });

  it("refuses PUSH_DISABLED for REASSERT_ELORAE while the Jubelio push switch is off, writing and enqueuing nothing", async () => {
    await setPushSwitch(false);
    const fx = await seedFixture({ qtyOnHand: 10, eloraeQty: 10, jubelioQty: 6 });

    const res = await resolveReconciliationItem({ resultId: fx.resultId, direction: "REASSERT_ELORAE", userId: "u1" });

    expect(res).toEqual({ success: false, reason: "PUSH_DISABLED" });
    expect(apiFetch).not.toHaveBeenCalled();

    const outbox = await prisma.jubelioOutbox.findMany({ where: { entityId: fx.itemId } });
    expect(outbox).toHaveLength(0);

    const result = await prisma.reconciliationResult.findUnique({ where: { id: fx.resultId } });
    expect(result!.action).toBe("FLAGGED");
  });
});

d("updateReconciliationSettings gated by the cutover switch (test bed only)", () => {
  const directionKey = "RECON_AUTO_CORRECT_DIRECTION";
  const thresholdKey = "RECON_AUTO_CORRECT_THRESHOLD";
  const cronKey = "RECON_CRON_ENABLED";

  /* Every key a save writes, plus the switch — all drive the live cron on the dev bed. */
  preserveSettings([directionKey, thresholdKey, cronKey, JUBELIO_STOCK_PUSH_ENABLED_KEY]);

  it("refuses to save REASSERT_ELORAE as the direction while the switch is off, leaving it unchanged", async () => {
    await setPushSwitch(false);
    const before = await prisma.systemSetting.findUnique({ where: { key: directionKey } });

    const res = await updateReconciliationSettings(0, "REASSERT_ELORAE", true);

    expect(res).toEqual({ success: false, reason: "PUSH_DISABLED" });
    const saved = await prisma.systemSetting.findUnique({ where: { key: directionKey } });
    expect(saved?.value ?? null).toBe(before?.value ?? null);
  });

  it("still saves any other direction while a stale REASSERT_ELORAE is stored and the switch is off", async () => {
    await setPushSwitch(false);
    await setSetting(directionKey, "REASSERT_ELORAE");

    const res = await updateReconciliationSettings(3, "FLAG_ONLY", false);

    expect(res).toEqual({ success: true });
    const saved = await prisma.systemSetting.findUnique({ where: { key: directionKey } });
    expect(saved?.value).toBe("FLAG_ONLY");
  });

  it("refuses an unknown direction without writing", async () => {
    await setPushSwitch(false);
    const before = await prisma.systemSetting.findUnique({ where: { key: directionKey } });

    const res = await updateReconciliationSettings(0, "SOMETHING_ELSE", true);

    expect(res).toEqual({ success: false, reason: "INVALID_DIRECTION" });
    const saved = await prisma.systemSetting.findUnique({ where: { key: directionKey } });
    expect(saved?.value ?? null).toBe(before?.value ?? null);
  });
});
