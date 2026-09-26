import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { runKonsiCountSweep } from "./sweep";
import { DEFAULT_COUNT_SCHEDULE, KONSI_COUNT_SYSTEM_ACTOR, type CountSchedule } from "./schedule";
import { KONSI_COUNT_DUE, KONSI_COUNT_OVERDUE } from "./categories";

/**
 * A pass-through spy on the real writer. Some cases replace one call: a manual open winning the
 * race, and a store failing.
 */
vi.mock("@/lib/stores/stocktake/writer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stores/stocktake/writer")>();
  return { ...actual, createStoreStocktake: vi.fn(actual.createStoreStocktake) };
});
import { createStoreStocktake } from "@/lib/stores/stocktake/writer";

const actualWriter = await vi.importActual<typeof import("@/lib/stores/stocktake/writer")>("@/lib/stores/stocktake/writer");

/* Stocktake-writing — never against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/* An instant on a WIB calendar day, 10:00 unless told otherwise. */
const wib = (isoDate: string, time = "10:00") => new Date(`${isoDate}T${time}:00.000+07:00`);
const DUE_15: CountSchedule = { dueDay: 15, leadDays: 3 };
const SLOW = 60_000;

d("runKonsiCountSweep (test bed only)", () => {
  const tag = `KCS-${Math.random().toString(36).slice(2, 10)}`;
  let runCounter = 0;
  let storeCounter = 0;
  let spgCounter = 0;
  let uomId = "";
  let itemId = "";
  let assortItemId = "";
  let storeIds: string[] = [];
  let userIds: string[] = [];

  async function seedStore(
    opts: { termsType?: "KONSI" | "PUTUS"; method?: "SPG_POS" | "SHELF_COUNT" | null; isActive?: boolean; createdAt?: Date } = {},
  ): Promise<string> {
    const store = await prisma.store.create({
      data: {
        code: `${tag}-${String(++storeCounter).padStart(3, "0")}`,
        name: `Test Count Schedule Store ${storeCounter}`,
        address: "Jl. Test",
        termsType: opts.termsType ?? "KONSI",
        sellThroughMethod: opts.method === undefined ? "SHELF_COUNT" : opts.method,
        isActive: opts.isActive ?? true,
        createdAt: opts.createdAt ?? wib("2026-09-01", "00:00"),
      },
    });
    storeIds.push(store.id);
    await prisma.storeStock.create({ data: { storeId: store.id, itemId, variantSku: "", qty: 5, avgCost: 0 } });
    await prisma.storeAssortmentLine.create({ data: { storeId: store.id, itemId: assortItemId, variantSku: "", createdById: "test" } });
    return store.id;
  }

  async function seedSpg(storeId: string): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `${tag}-spg-${++spgCounter}@example.com`.toLowerCase(), name: "Test Count SPG", assignedStoreId: storeId },
    });
    userIds.push(user.id);
    return user.id;
  }

  async function notificationsFor(category: string, storeId: string) {
    const rows = await prisma.adminNotification.findMany({ where: { category }, select: { id: true, message: true, metadata: true } });
    return rows.filter((r) => (r.metadata as { storeId?: string } | null)?.storeId === storeId);
  }

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    assortItemId = "";
    storeIds = [];
    userIds = [];
    vi.mocked(createStoreStocktake).mockReset();
    vi.mocked(createStoreStocktake).mockImplementation(actualWriter.createStoreStocktake);
    const run = ++runCounter;

    const uom = await prisma.uOM.create({ data: { code: `U-${tag}-${run}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `${tag}-STOCK-${run}`, nameId: "Stocked", nameEn: "Stocked", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 1000 },
    });
    itemId = item.id;
    const assort = await prisma.item.create({
      data: { sku: `${tag}-ASSORT-${run}`, nameId: "Assortment", nameEn: "Assortment", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 1000 },
    });
    assortItemId = assort.id;
  });

  afterEach(async () => {
    const rows = await prisma.adminNotification.findMany({
      where: { category: { in: [KONSI_COUNT_DUE, KONSI_COUNT_OVERDUE] } },
      select: { id: true, metadata: true },
    });
    const ours = rows.filter((r) => storeIds.includes((r.metadata as { storeId?: string } | null)?.storeId ?? ""));
    if (ours.length > 0) await prisma.adminNotification.deleteMany({ where: { id: { in: ours.map((r) => r.id) } } });
    await prisma.storeStocktakeLine.deleteMany({ where: { stocktake: { storeId: { in: storeIds } } } });
    await prisma.storeStocktake.deleteMany({ where: { storeId: { in: storeIds } } });
    await prisma.storeAssortmentLine.deleteMany({ where: { storeId: { in: storeIds } } });
    await prisma.storeStock.deleteMany({ where: { storeId: { in: storeIds } } });
    await prisma.notificationQueue.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
    await prisma.item.deleteMany({ where: { id: { in: [seededId(itemId), seededId(assortItemId)] } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("opens one DRAFT full count for a DUE store, created by its single SPG, and never a second while it is open", async () => {
    const storeId = await seedStore();
    const spgId = await seedSpg(storeId);
    const now = wib("2026-09-28");

    const first = await runKonsiCountSweep({ storeIds: [storeId], now, schedule: DEFAULT_COUNT_SCHEDULE });
    expect(first).toEqual({ scanned: 1, opened: 1, alreadyOpen: 0, existingAnnounced: 0, spgNotified: 1, overdueAnnounced: 0, failed: 0 });

    const open = await prisma.storeStocktake.findMany({
      where: { storeId: seededId(storeId), openKey: { not: null } },
      include: { lines: true },
    });
    expect(open).toHaveLength(1);
    expect(open[0].status).toBe("DRAFT");
    expect(open[0].createdById).toBe(spgId);
    expect(open[0].note).toBe("Dibuka otomatis untuk perhitungan bulanan September 2026");
    expect(open[0].countedAt.toISOString()).toBe(now.toISOString());
    expect(open[0].lines.map((l) => l.itemId).sort()).toEqual([itemId, assortItemId].sort());
    expect(open[0].lines.every((l) => l.countedQty === null)).toBe(true);

    const due = await notificationsFor(KONSI_COUNT_DUE, storeId);
    expect(due).toHaveLength(1);
    expect(due[0].metadata).toMatchObject({ storeId, stocktakeId: open[0].id, docNo: open[0].docNo, monthKey: "2026-09", dueDate: "2026-09-30" });
    expect(due[0].message).toBe(`Perhitungan ${open[0].docNo} dibuka otomatis untuk September 2026, batas waktu 30 September 2026.`);

    const second = await runKonsiCountSweep({ storeIds: [storeId], now: wib("2026-09-29"), schedule: DEFAULT_COUNT_SCHEDULE });
    expect(second).toEqual({ scanned: 1, opened: 0, alreadyOpen: 0, existingAnnounced: 0, spgNotified: 0, overdueAnnounced: 0, failed: 0 });
    expect(await prisma.storeStocktake.count({ where: { storeId: seededId(storeId) } })).toBe(1);
    expect(await notificationsFor(KONSI_COUNT_DUE, storeId)).toHaveLength(1);

    /* The SPG push is guarded under VITEST: intent is counted, nothing is queued or sent. */
    expect(await prisma.notificationQueue.count({ where: { userId: seededId(spgId) } })).toBe(0);
  }, SLOW);

  it("uses the system actor when the store has two SPGs, and pushes to both; and when it has none, says so on the DUE alert", async () => {
    const twoSpgStore = await seedStore();
    const spgA = await seedSpg(twoSpgStore);
    const spgB = await seedSpg(twoSpgStore);
    const noSpgStore = await seedStore();

    const r = await runKonsiCountSweep({ storeIds: [twoSpgStore, noSpgStore], now: wib("2026-09-28"), schedule: DEFAULT_COUNT_SCHEDULE });
    expect(r).toEqual({ scanned: 2, opened: 2, alreadyOpen: 0, existingAnnounced: 0, spgNotified: 2, overdueAnnounced: 0, failed: 0 });

    const docs = await prisma.storeStocktake.findMany({
      where: { storeId: { in: [seededId(twoSpgStore), seededId(noSpgStore)] } },
      select: { createdById: true },
    });
    expect(docs.map((doc) => doc.createdById)).toEqual([KONSI_COUNT_SYSTEM_ACTOR, KONSI_COUNT_SYSTEM_ACTOR]);
    expect(await prisma.notificationQueue.count({ where: { userId: { in: [seededId(spgA), seededId(spgB)] } } })).toBe(0);

    const noSpgSuffix = "Toko ini belum punya SPG, jadi perhitungan perlu diisi dari backoffice.";
    const [noSpgDue] = await notificationsFor(KONSI_COUNT_DUE, noSpgStore);
    expect(noSpgDue.message).toContain(noSpgSuffix);
    const [twoSpgDue] = await notificationsFor(KONSI_COUNT_DUE, twoSpgStore);
    expect(twoSpgDue.message).not.toContain(noSpgSuffix);
  }, SLOW);

  it("skips a counted store, a store not yet due, a store with no method, a PUTUS store and an inactive store", async () => {
    const done = await seedStore();
    /* Opened before September's window (27 September) but finished inside it: the count moment, not `countedAt`, credits September. */
    await prisma.storeStocktake.create({
      data: {
        docNo: `STK/${tag}/done-${storeCounter}`,
        storeId: done,
        status: "APPROVED",
        isFullCount: true,
        countedAt: wib("2026-09-20"),
        countFinishedAt: wib("2026-09-27"),
        approvedAt: wib("2026-09-27", "15:00"),
        createdById: "test",
      },
    });
    const noMethod = await seedStore({ method: null });
    const putus = await seedStore({ termsType: "PUTUS" });
    const inactive = await seedStore({ isActive: false });
    const all = [done, noMethod, putus, inactive];

    const r = await runKonsiCountSweep({ storeIds: all, now: wib("2026-09-28"), schedule: DEFAULT_COUNT_SCHEDULE });
    expect(r).toEqual({ scanned: 1, opened: 0, alreadyOpen: 0, existingAnnounced: 0, spgNotified: 0, overdueAnnounced: 0, failed: 0 });
    /* Only the seeded APPROVED row exists: nothing was opened at any of the four. */
    expect(await prisma.storeStocktake.count({ where: { storeId: { in: all } } })).toBe(1);

    const early = await seedStore();
    const notYet = await runKonsiCountSweep({ storeIds: [early], now: wib("2026-09-10"), schedule: DEFAULT_COUNT_SCHEDULE });
    expect(notYet).toEqual({ scanned: 1, opened: 0, alreadyOpen: 0, existingAnnounced: 0, spgNotified: 0, overdueAnnounced: 0, failed: 0 });
  }, SLOW);

  it("does not treat an approved PARTIAL count as the month's count", async () => {
    const storeId = await seedStore();
    await prisma.storeStocktake.create({
      data: {
        docNo: `STK/${tag}/partial-${storeCounter}`,
        storeId,
        status: "APPROVED",
        isFullCount: false,
        countedAt: wib("2026-09-05"),
        approvedAt: wib("2026-09-06"),
        createdById: "test",
      },
    });
    const r = await runKonsiCountSweep({ storeIds: [storeId], now: wib("2026-09-28"), schedule: DEFAULT_COUNT_SCHEDULE });
    expect(r.opened).toBe(1);
  }, SLOW);

  it("announces OVERDUE once per store and month, stays quiet while the missed month is still the target, and announces the next month again", async () => {
    const storeId = await seedStore();

    const sep20 = await runKonsiCountSweep({ storeIds: [storeId], now: wib("2026-09-20"), schedule: DUE_15 });
    expect(sep20).toMatchObject({ opened: 1, overdueAnnounced: 1, failed: 0 });
    const openDoc = await prisma.storeStocktake.findFirstOrThrow({ where: { storeId: seededId(storeId), openKey: { not: null } } });

    const sep21 = await runKonsiCountSweep({ storeIds: [storeId], now: wib("2026-09-21"), schedule: DUE_15 });
    expect(sep21).toMatchObject({ opened: 0, overdueAnnounced: 0 });

    /* 5 October: October's window has not opened, so September is still the OVERDUE target, already announced. */
    const oct5 = await runKonsiCountSweep({ storeIds: [storeId], now: wib("2026-10-05"), schedule: DUE_15 });
    expect(oct5).toMatchObject({ opened: 0, existingAnnounced: 0, overdueAnnounced: 0 });

    /* 16 October: October is the target now. The still-open count is announced for it, not re-created. */
    const oct16 = await runKonsiCountSweep({ storeIds: [storeId], now: wib("2026-10-16"), schedule: DUE_15 });
    expect(oct16).toMatchObject({ opened: 0, existingAnnounced: 1, overdueAnnounced: 1 });

    const rows = await notificationsFor(KONSI_COUNT_OVERDUE, storeId);
    expect(rows.map((n) => (n.metadata as { monthKey: string }).monthKey).sort()).toEqual(["2026-09", "2026-10"]);
    expect(rows.every((n) => (n.metadata as { stocktakeId: string }).stocktakeId === openDoc.id)).toBe(true);
  }, SLOW);

  it("with the last-day default, raises OVERDUE for the missed month on the first morning of the next one", async () => {
    const storeId = await seedStore({ createdAt: wib("2026-01-01", "00:00") });
    const r = await runKonsiCountSweep({ storeIds: [storeId], now: wib("2026-10-01", "07:00"), schedule: DEFAULT_COUNT_SCHEDULE });
    expect(r).toMatchObject({ opened: 1, overdueAnnounced: 1, failed: 0 });

    const overdue = await notificationsFor(KONSI_COUNT_OVERDUE, storeId);
    expect(overdue).toHaveLength(1);
    expect(overdue[0].metadata).toMatchObject({ storeId, monthKey: "2026-09", dueDate: "2026-09-30" });
    expect(overdue[0].message).toBe("Belum ada perhitungan penuh yang disetujui untuk September 2026 (batas waktu 30 September 2026).");
    const doc = await prisma.storeStocktake.findFirstOrThrow({ where: { storeId: seededId(storeId) } });
    expect(doc.note).toBe("Dibuka otomatis untuk perhitungan bulanan September 2026");
  }, SLOW);

  /* A manual open lands between the sweep's read and its own create. */
  function raceWithManualOpen() {
    vi.mocked(createStoreStocktake).mockImplementationOnce(async (input) => {
      await actualWriter.createStoreStocktake({ storeId: input.storeId, createdById: "manual-admin", countedAt: input.countedAt });
      return actualWriter.createStoreStocktake(input);
    });
  }

  it("treats ALREADY_OPEN from a racing manual open as already open, not a failure, and announces that count", async () => {
    const storeId = await seedStore();
    raceWithManualOpen();

    const r = await runKonsiCountSweep({ storeIds: [storeId], now: wib("2026-09-28"), schedule: DEFAULT_COUNT_SCHEDULE });
    expect(r).toEqual({ scanned: 1, opened: 0, alreadyOpen: 1, existingAnnounced: 1, spgNotified: 0, overdueAnnounced: 0, failed: 0 });

    const docs = await prisma.storeStocktake.findMany({ where: { storeId: seededId(storeId) }, select: { id: true, createdById: true, openKey: true } });
    expect(docs).toEqual([{ id: expect.any(String), createdById: "manual-admin", openKey: storeId }]);
    const due = await notificationsFor(KONSI_COUNT_DUE, storeId);
    expect(due).toHaveLength(1);
    expect(due[0].metadata).toMatchObject({ storeId, stocktakeId: docs[0].id, monthKey: "2026-09" });
  }, SLOW);

  it("puts the raced count's id into the OVERDUE alert when ALREADY_OPEN happens while OVERDUE", async () => {
    const storeId = await seedStore();
    raceWithManualOpen();

    const r = await runKonsiCountSweep({ storeIds: [storeId], now: wib("2026-09-20"), schedule: DUE_15 });
    expect(r).toMatchObject({ opened: 0, alreadyOpen: 1, existingAnnounced: 1, overdueAnnounced: 1, failed: 0 });

    const raced = await prisma.storeStocktake.findFirstOrThrow({ where: { storeId: seededId(storeId), openKey: { not: null } } });
    const overdue = await notificationsFor(KONSI_COUNT_OVERDUE, storeId);
    expect(overdue).toHaveLength(1);
    expect(overdue[0].metadata).toMatchObject({ storeId, monthKey: "2026-09", stocktakeId: raced.id });
  }, SLOW);

  it("announces a count that is already open with no DUE alert yet, and does not create another", async () => {
    const storeId = await seedStore();
    const spgId = await seedSpg(storeId);
    const manual = await actualWriter.createStoreStocktake({ storeId, createdById: "manual-admin", countedAt: wib("2026-09-20") });

    const r = await runKonsiCountSweep({ storeIds: [storeId], now: wib("2026-09-28"), schedule: DEFAULT_COUNT_SCHEDULE });
    expect(r).toEqual({ scanned: 1, opened: 0, alreadyOpen: 0, existingAnnounced: 1, spgNotified: 1, overdueAnnounced: 0, failed: 0 });
    expect(createStoreStocktake).not.toHaveBeenCalled();
    expect(await prisma.storeStocktake.count({ where: { storeId: seededId(storeId) } })).toBe(1);

    const due = await notificationsFor(KONSI_COUNT_DUE, storeId);
    expect(due).toHaveLength(1);
    expect(due[0].metadata).toMatchObject({ storeId, stocktakeId: manual.id, docNo: manual.docNo, monthKey: "2026-09" });
    expect(due[0].message).toBe(`Perhitungan ${manual.docNo} sudah terbuka untuk September 2026, batas waktu 30 September 2026.`);
    expect(await prisma.notificationQueue.count({ where: { userId: seededId(spgId) } })).toBe(0);
  }, SLOW);

  it("does not announce an open count finished before the target window, and opens a fresh one once it closes", async () => {
    const storeId = await seedStore();
    const spgId = await seedSpg(storeId);
    /* Counted on 24 September, before September's window opens on the 27th: once approved it credits August's slot. */
    const early = await actualWriter.createStoreStocktake({ storeId, createdById: "manual-admin", countedAt: wib("2026-09-20") });
    await prisma.storeStocktake.update({
      where: { id: early.id },
      data: { status: "PENDING_VERIFICATION", countFinishedAt: wib("2026-09-24") },
    });

    const sep27 = await runKonsiCountSweep({ storeIds: [storeId], now: wib("2026-09-27"), schedule: DEFAULT_COUNT_SCHEDULE });
    expect(sep27).toEqual({ scanned: 1, opened: 0, alreadyOpen: 0, existingAnnounced: 0, spgNotified: 0, overdueAnnounced: 0, failed: 0 });
    expect(createStoreStocktake).not.toHaveBeenCalled();
    expect(await notificationsFor(KONSI_COUNT_DUE, storeId)).toHaveLength(0);
    expect(await prisma.notificationQueue.count({ where: { userId: seededId(spgId) } })).toBe(0);

    await actualWriter.cancelStoreStocktake({ stocktakeId: early.id, cancelledById: "test", reason: "counted too early" });

    const sep28 = await runKonsiCountSweep({ storeIds: [storeId], now: wib("2026-09-28"), schedule: DEFAULT_COUNT_SCHEDULE });
    expect(sep28).toEqual({ scanned: 1, opened: 1, alreadyOpen: 0, existingAnnounced: 0, spgNotified: 1, overdueAnnounced: 0, failed: 0 });
    const fresh = await prisma.storeStocktake.findFirstOrThrow({ where: { storeId: seededId(storeId), openKey: { not: null } } });
    expect(fresh.id).not.toBe(early.id);
    const due = await notificationsFor(KONSI_COUNT_DUE, storeId);
    expect(due).toHaveLength(1);
    expect(due[0].metadata).toMatchObject({ storeId, stocktakeId: fresh.id, monthKey: "2026-09" });
  }, SLOW);

  it("announces an open count whose count moment is still to come, or falls on the window's first instant", async () => {
    /* Opened before the window with no count saved yet: `countedAt` never decides the month. */
    const pending = await seedStore();
    const pendingDoc = await actualWriter.createStoreStocktake({ storeId: pending, createdById: "manual-admin", countedAt: wib("2026-09-10") });
    expect((await prisma.storeStocktake.findUniqueOrThrow({ where: { id: pendingDoc.id } })).countFinishedAt).toBeNull();

    /* Finished at 00:00 WIB on 27 September, the window's `openFrom`, which credits September. */
    const boundary = await seedStore();
    const boundaryDoc = await actualWriter.createStoreStocktake({ storeId: boundary, createdById: "manual-admin", countedAt: wib("2026-09-20") });
    await prisma.storeStocktake.update({
      where: { id: boundaryDoc.id },
      data: { status: "PENDING_VERIFICATION", countFinishedAt: wib("2026-09-27", "00:00") },
    });

    const r = await runKonsiCountSweep({ storeIds: [pending, boundary], now: wib("2026-09-28"), schedule: DEFAULT_COUNT_SCHEDULE });
    expect(r).toEqual({ scanned: 2, opened: 0, alreadyOpen: 0, existingAnnounced: 2, spgNotified: 0, overdueAnnounced: 0, failed: 0 });
    expect(createStoreStocktake).not.toHaveBeenCalled();
    const [pendingDue] = await notificationsFor(KONSI_COUNT_DUE, pending);
    expect(pendingDue.metadata).toMatchObject({ storeId: pending, stocktakeId: pendingDoc.id, monthKey: "2026-09" });
    const [boundaryDue] = await notificationsFor(KONSI_COUNT_DUE, boundary);
    expect(boundaryDue.metadata).toMatchObject({ storeId: boundary, stocktakeId: boundaryDoc.id, monthKey: "2026-09" });
  }, SLOW);

  it("does not reopen a cancelled count for the same month, and still raises OVERDUE for it", async () => {
    const storeId = await seedStore();

    const sep13 = await runKonsiCountSweep({ storeIds: [storeId], now: wib("2026-09-13"), schedule: DUE_15 });
    expect(sep13).toMatchObject({ opened: 1, failed: 0 });
    const opened = await prisma.storeStocktake.findFirstOrThrow({ where: { storeId: seededId(storeId), openKey: { not: null } } });
    await actualWriter.cancelStoreStocktake({ stocktakeId: opened.id, cancelledById: "test", reason: "opened by mistake" });

    const sep14 = await runKonsiCountSweep({ storeIds: [storeId], now: wib("2026-09-14"), schedule: DUE_15 });
    expect(sep14).toEqual({ scanned: 1, opened: 0, alreadyOpen: 0, existingAnnounced: 0, spgNotified: 0, overdueAnnounced: 0, failed: 0 });
    expect(await prisma.storeStocktake.count({ where: { storeId: seededId(storeId) } })).toBe(1);

    const sep16 = await runKonsiCountSweep({ storeIds: [storeId], now: wib("2026-09-16"), schedule: DUE_15 });
    expect(sep16).toMatchObject({ opened: 0, existingAnnounced: 0, overdueAnnounced: 1, failed: 0 });
    expect(await prisma.storeStocktake.count({ where: { storeId: seededId(storeId) } })).toBe(1);
    expect(await notificationsFor(KONSI_COUNT_DUE, storeId)).toHaveLength(1);
    const overdue = await notificationsFor(KONSI_COUNT_OVERDUE, storeId);
    expect(overdue).toHaveLength(1);
    expect(overdue[0].metadata).toMatchObject({ storeId, monthKey: "2026-09", stocktakeId: "" });
  }, SLOW);

  it("keeps sweeping after one store fails", async () => {
    const failing = await seedStore();
    const healthy = await seedStore();
    vi.mocked(createStoreStocktake).mockRejectedValueOnce(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await runKonsiCountSweep({ storeIds: [failing, healthy], now: wib("2026-09-28"), schedule: DEFAULT_COUNT_SCHEDULE });
    errorSpy.mockRestore();

    expect(r).toMatchObject({ scanned: 2, opened: 1, failed: 1 });
    expect(await prisma.storeStocktake.count({ where: { storeId: seededId(failing) } })).toBe(0);
    expect(await prisma.storeStocktake.count({ where: { storeId: seededId(healthy) } })).toBe(1);
  }, SLOW);

  it("scans nothing for an empty storeIds list — never the whole database", async () => {
    const storeId = await seedStore();
    const r = await runKonsiCountSweep({ storeIds: [], now: wib("2026-09-28"), schedule: DEFAULT_COUNT_SCHEDULE });
    expect(r).toEqual({ scanned: 0, opened: 0, alreadyOpen: 0, existingAnnounced: 0, spgNotified: 0, overdueAnnounced: 0, failed: 0 });
    expect(await prisma.storeStocktake.count({ where: { storeId: seededId(storeId) } })).toBe(0);
  }, SLOW);
});
