import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createSellThroughFixtures } from "@/lib/konsi-sell-through/test-fixtures";
import { SellThroughError } from "@/lib/konsi-sell-through/errors";
import { autoCreateSellThroughAfterCount } from "./auto-report";
import { KONSI_REPORT_BLOCKED, KONSI_REPORT_HELD, KONSI_REPORT_READY } from "./categories";

/* A pass-through spy on the real writer, so one case can make it throw something unexpected. */
vi.mock("@/lib/konsi-sell-through/writer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/konsi-sell-through/writer")>();
  return { ...actual, createSellThrough: vi.fn(actual.createSellThrough) };
});
import { createSellThrough } from "@/lib/konsi-sell-through/writer";

const actualWriter = await vi.importActual<typeof import("@/lib/konsi-sell-through/writer")>("@/lib/konsi-sell-through/writer");

/* Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/* Every case drives several real serializable writers end to end, well past vitest's 5s default. */
const SLOW = 60_000;
const CATEGORIES = [KONSI_REPORT_READY, KONSI_REPORT_HELD, KONSI_REPORT_BLOCKED];

d("autoCreateSellThroughAfterCount (test bed only)", () => {
  const fx = createSellThroughFixtures();
  const { state, tick, setMethod, transferIn, spgSell, count, raiseRetur } = fx;

  async function notificationsFor(category: string) {
    const rows = await prisma.adminNotification.findMany({ where: { category }, select: { id: true, message: true, metadata: true } });
    return rows.filter((r) => (r.metadata as { storeId?: string } | null)?.storeId === state.storeId);
  }

  async function reportsForStore() {
    return prisma.konsiSellThrough.findMany({ where: { storeId: seededId(state.storeId) }, select: { id: true, status: true, closingStocktakeId: true, createdById: true } });
  }

  beforeEach(async () => {
    vi.mocked(createSellThrough).mockReset();
    vi.mocked(createSellThrough).mockImplementation(actualWriter.createSellThrough);
    await fx.beforeEach();
  });

  afterEach(async () => {
    try {
      /* No storeId column on AdminNotification: match our own store in JS and delete by explicit id list, never by category alone. */
      const rows = await prisma.adminNotification.findMany({ where: { category: { in: CATEGORIES } }, select: { id: true, metadata: true } });
      const ours = rows.filter((r) => (r.metadata as { storeId?: string } | null)?.storeId === state.storeId && state.storeId !== "");
      if (ours.length > 0) await prisma.adminNotification.deleteMany({ where: { id: { in: ours.map((r) => r.id) } } });
    } finally {
      await fx.afterEach();
    }
  });

  it("creates the DRAFT report from an approved full count and announces it READY", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });

    const outcome = await autoCreateSellThroughAfterCount(stocktakeId, state.userId);
    expect(outcome.kind).toBe("READY");

    const reports = await reportsForStore();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ status: "DRAFT", closingStocktakeId: stocktakeId, createdById: state.userId });
    expect(outcome).toMatchObject({ sellThroughId: reports[0].id });

    const ready = await notificationsFor(KONSI_REPORT_READY);
    expect(ready).toHaveLength(1);
    expect(ready[0].metadata).toMatchObject({ storeId: state.storeId, stocktakeId, sellThroughId: reports[0].id });
    expect(await notificationsFor(KONSI_REPORT_HELD)).toHaveLength(0);
    expect(await notificationsFor(KONSI_REPORT_BLOCKED)).toHaveLength(0);
  }, SLOW);

  it("announces HELD with the number of held lines when an SPG_POS report holds", async () => {
    await setMethod("SPG_POS");
    await transferIn(6);
    await spgSell(3);
    const stocktakeId = await count(1, { cause: "SHRINKAGE", reason: "two units missing" });

    const outcome = await autoCreateSellThroughAfterCount(stocktakeId, state.userId);
    expect(outcome).toMatchObject({ kind: "HELD", heldCount: 1 });

    const held = await notificationsFor(KONSI_REPORT_HELD);
    expect(held).toHaveLength(1);
    expect(held[0].metadata).toMatchObject({ storeId: state.storeId, heldCount: 1 });
    expect(held[0].message).toContain("1 baris");
    expect(await notificationsFor(KONSI_REPORT_READY)).toHaveLength(0);
  }, SLOW);

  it("announces BLOCKED with a short pointer to the stocktake while the count stays approved, for a retur in flight", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const { docNo } = await raiseRetur(2);
    await tick();
    const stocktakeId = await count(4, { cause: "SHRINKAGE", reason: "two units off the shelf" });

    const outcome = await autoCreateSellThroughAfterCount(stocktakeId, state.userId);
    expect(outcome).toEqual({ kind: "BLOCKED", code: "RETUR_IN_FLIGHT", detail: docNo });

    expect(await reportsForStore()).toHaveLength(0);
    const stocktake = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(stocktakeId) } });
    expect(stocktake.status).toBe("APPROVED");
    const blocked = await notificationsFor(KONSI_REPORT_BLOCKED);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].metadata).toMatchObject({ storeId: state.storeId, stocktakeId, code: "RETUR_IN_FLIGHT", detail: docNo });
    expect(blocked[0].message).toBe(
      `Perhitungan ${stocktake.docNo} disetujui, tetapi laporan sell-through tidak bisa dibuat otomatis (kode RETUR_IN_FLIGHT). Buka perhitungan ini untuk melihat alasannya.`,
    );
    expect(Array.from(blocked[0].message).length).toBeLessThanOrEqual(191);
  }, SLOW);

  it("announces BLOCKED DRAFT_EXISTS when the store's previous report is still a draft", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const first = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    expect((await autoCreateSellThroughAfterCount(first, state.userId)).kind).toBe("READY");
    await tick();
    const second = await count(2);

    const outcome = await autoCreateSellThroughAfterCount(second, state.userId);
    expect(outcome).toMatchObject({ kind: "BLOCKED", code: "DRAFT_EXISTS" });
    expect(await reportsForStore()).toHaveLength(1);
  }, SLOW);

  it("skips a count someone already created the report for by hand (ALREADY_USED), and announces nothing", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(6);
    const byHand = await actualWriter.createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });

    expect(await autoCreateSellThroughAfterCount(stocktakeId, state.userId)).toEqual({ kind: "SKIPPED" });
    expect((await reportsForStore()).map((r) => r.id)).toEqual([byHand.id]);
    for (const category of CATEGORIES) expect(await notificationsFor(category)).toHaveLength(0);
  }, SLOW);

  it("skips DRAFT_EXISTS when a live report already closes this count, the race a hand-created report can win", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(6);
    vi.mocked(createSellThrough).mockImplementationOnce(async (input) => {
      await actualWriter.createSellThrough(input);
      throw new SellThroughError("DRAFT_EXISTS");
    });

    expect(await autoCreateSellThroughAfterCount(stocktakeId, state.userId)).toEqual({ kind: "SKIPPED" });
    expect(await reportsForStore()).toHaveLength(1);
    for (const category of CATEGORIES) expect(await notificationsFor(category)).toHaveLength(0);
  }, SLOW);

  it("skips a stocktake that is not approved, and an unknown stocktake id", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const pending = await count(6, { approve: false });

    expect(await autoCreateSellThroughAfterCount(pending, state.userId)).toEqual({ kind: "SKIPPED" });
    expect(await autoCreateSellThroughAfterCount("no-such-stocktake", state.userId)).toEqual({ kind: "SKIPPED" });
    expect(await reportsForStore()).toHaveLength(0);
    for (const category of CATEGORIES) expect(await notificationsFor(category)).toHaveLength(0);
  }, SLOW);

  it("does nothing for a partial count, a store with no method, or a PUTUS store", async () => {
    await transferIn(6);

    /* No method (the fixture store starts with none). */
    const full = await count(6);
    expect(await autoCreateSellThroughAfterCount(full, state.userId)).toEqual({ kind: "SKIPPED" });

    await setMethod("SHELF_COUNT");
    const partial = await count(null);
    expect(await autoCreateSellThroughAfterCount(partial, state.userId)).toEqual({ kind: "SKIPPED" });

    const beforePutus = await count(6);
    /* A direct write past the store form's KONSI-only method guard, to prove the terms gate on its own. */
    await prisma.store.update({ where: { id: state.storeId }, data: { termsType: "PUTUS" } });
    expect(await autoCreateSellThroughAfterCount(beforePutus, state.userId)).toEqual({ kind: "SKIPPED" });

    expect(await reportsForStore()).toHaveLength(0);
    for (const category of CATEGORIES) expect(await notificationsFor(category)).toHaveLength(0);
  }, SLOW);

  it("swallows an unexpected failure: returns FAILED, never throws, announces nothing, and the count stays approved", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(6);
    vi.mocked(createSellThrough).mockRejectedValueOnce(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await autoCreateSellThroughAfterCount(stocktakeId, state.userId);
    errorSpy.mockRestore();

    expect(outcome).toEqual({ kind: "FAILED" });
    expect((await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(stocktakeId) } })).status).toBe("APPROVED");
    for (const category of CATEGORIES) expect(await notificationsFor(category)).toHaveLength(0);
  }, SLOW);
});
