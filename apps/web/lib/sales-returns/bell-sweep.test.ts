import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { runSalesReturnBellSweep } from "./bell-sweep";
import { SALES_RETURN_RECEIVED } from "./bell-copy";
import { BELL_FLOOR_SETTING_KEY } from "./bell-floor";

/* Seeds sales-return and notification rows — never run against the shared prod DB. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const FLOOR = new Date("2026-10-01T00:00:00.000Z");
const NOW = new Date("2026-10-13T05:00:00.000Z");

type Meta = { salesReturnId?: string };

async function notificationsFor(salesReturnId: string) {
  const rows = await prisma.adminNotification.findMany({
    where: { category: SALES_RETURN_RECEIVED },
    select: { id: true, title: true, message: true, severity: true, metadata: true },
  });
  return rows.filter((r) => (r.metadata as Meta | null)?.salesReturnId === salesReturnId);
}

d("runSalesReturnBellSweep (test bed only)", () => {
  let returnIds: string[] = [];
  /**
   * `salesReturns.bellFloor` is a SHARED singleton on the `:3308` bed that the real cron writes.
   * Snapshot it, pin it per test, restore it after — never delete it unconditionally.
   */
  let floorSnapshot: string | null = null;
  let hadFloor = false;

  /* Negative ids cannot collide with real Jubelio return ids. */
  function nextJubelioId(): number {
    return -Math.floor(1 + Math.random() * 2_000_000_000);
  }

  async function makeReturn(opts: {
    createdAt: Date;
    status?: "PENDING" | "ACCEPTED" | "REJECTED" | "PARTIAL";
    jubelioReturnNo?: string | null;
  }): Promise<string> {
    const row = await prisma.salesReturn.create({
      data: {
        jubelioReturnId: nextJubelioId(),
        jubelioReturnNo: opts.jubelioReturnNo === undefined ? null : opts.jubelioReturnNo,
        channel: "SHOPEE",
        channelOrderNo: null,
        status: opts.status ?? "PENDING",
        buyerName: "Test Buyer Do Not Notify",
        totalQty: 2,
        totalValue: 150000,
        receivedAt: opts.createdAt,
        rawIngestPayload: {},
        createdAt: opts.createdAt,
      },
    });
    returnIds.push(row.id);
    return row.id;
  }

  async function setFloor(value: string | null): Promise<void> {
    if (value === null) {
      await prisma.systemSetting.deleteMany({ where: { key: BELL_FLOOR_SETTING_KEY } });
      return;
    }
    await prisma.systemSetting.upsert({
      where: { key: BELL_FLOOR_SETTING_KEY },
      create: { key: BELL_FLOOR_SETTING_KEY, value },
      update: { value },
    });
  }

  beforeEach(async () => {
    returnIds = [];
    const existing = await prisma.systemSetting.findUnique({
      where: { key: BELL_FLOOR_SETTING_KEY },
      select: { value: true },
    });
    hadFloor = existing !== null;
    floorSnapshot = existing?.value ?? null;
    await setFloor(FLOOR.toISOString());
  });

  /* Notifications before their returns; each step guarded so one failure cannot skip the rest. */
  afterEach(async () => {
    try {
      const rows = (await Promise.all(returnIds.map((id) => notificationsFor(id)))).flat();
      if (rows.length > 0) await prisma.adminNotification.deleteMany({ where: { id: { in: rows.map((r) => seededId(r.id)) } } });
    } catch (e) {
      console.warn("[bell-sweep.test.ts] failed to delete test notifications", returnIds, e);
    }
    try {
      await prisma.salesReturn.deleteMany({ where: { id: { in: returnIds.map(seededId) } } });
    } catch (e) {
      console.warn("[bell-sweep.test.ts] failed to delete test returns", returnIds, e);
    }
    await setFloor(hadFloor ? floorSnapshot : null);
  });

  it("writes the floor on its first run and announces nothing", async () => {
    await setFloor(null);
    const id = await makeReturn({ createdAt: new Date("2026-10-12T00:00:00.000Z") });

    const result = await runSalesReturnBellSweep({ returnIds: [id], now: NOW });
    expect(result).toEqual({ scanned: 0, announced: 0, deferred: 0, failed: 0, flooredNow: true });

    const floor = await prisma.systemSetting.findUnique({ where: { key: BELL_FLOOR_SETTING_KEY }, select: { value: true } });
    expect(floor?.value).toBe(NOW.toISOString());
    expect(await notificationsFor(id)).toHaveLength(0);
  });

  it("announces a new pending return once, and a rerun adds nothing", async () => {
    const id = await makeReturn({ createdAt: new Date("2026-10-12T00:00:00.000Z"), jubelioReturnNo: "RET-T-1" });

    const first = await runSalesReturnBellSweep({ returnIds: [id], now: NOW });
    expect(first).toEqual({ scanned: 1, announced: 1, deferred: 0, failed: 0, flooredNow: false });

    const rows = await notificationsFor(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe("INFO");
    expect(rows[0].title).toBe("Retur baru dari Shopee — RET-T-1");
    expect(rows[0].metadata).toEqual({
      salesReturnId: id,
      jubelioReturnNo: "RET-T-1",
      channel: "SHOPEE",
      totalQty: 2,
      totalValue: 150000,
    });
    for (const text of [rows[0].title, rows[0].message, JSON.stringify(rows[0].metadata)]) {
      expect(text).not.toContain("Test Buyer");
    }

    const second = await runSalesReturnBellSweep({ returnIds: [id], now: NOW });
    expect(second.announced).toBe(0);
    expect(await notificationsFor(id)).toHaveLength(1);
  });

  it("announces a return created exactly at the floor", async () => {
    const id = await makeReturn({ createdAt: FLOOR });
    const result = await runSalesReturnBellSweep({ returnIds: [id], now: NOW });
    expect(result.announced).toBe(1);
  });

  it("skips decided returns and returns older than the floor", async () => {
    const ids = [
      await makeReturn({ createdAt: new Date("2026-10-12T00:00:00.000Z"), status: "ACCEPTED" }),
      await makeReturn({ createdAt: new Date("2026-10-12T00:00:00.000Z"), status: "REJECTED" }),
      await makeReturn({ createdAt: new Date("2026-10-12T00:00:00.000Z"), status: "PARTIAL" }),
      await makeReturn({ createdAt: new Date("2026-09-30T23:59:59.000Z") }),
    ];
    const result = await runSalesReturnBellSweep({ returnIds: ids, now: NOW });
    expect(result).toEqual({ scanned: 0, announced: 0, deferred: 0, failed: 0, flooredNow: false });
  });

  it("defers past the cap, oldest first", async () => {
    const later = await makeReturn({ createdAt: new Date("2026-10-12T02:00:00.000Z") });
    const earlier = await makeReturn({ createdAt: new Date("2026-10-12T01:00:00.000Z") });
    const result = await runSalesReturnBellSweep({ returnIds: [later, earlier], now: NOW, maxAnnouncementsPerRun: 1 });
    expect(result).toEqual({ scanned: 2, announced: 1, deferred: 1, failed: 0, flooredNow: false });
    expect(await notificationsFor(earlier)).toHaveLength(1);
    expect(await notificationsFor(later)).toHaveLength(0);
  });

  it("keeps going when one return's write fails, and retries it next run", async () => {
    const earlier = await makeReturn({ createdAt: new Date("2026-10-12T01:00:00.000Z") });
    const later = await makeReturn({ createdAt: new Date("2026-10-12T02:00:00.000Z") });

    /*
     * `prisma` is a Proxy over a singleton client: bind the original first, make it the spy's
     * default, queue the one failure on top, and pin it back in `finally` — never mockRestore.
     */
    const original = prisma.adminNotification.create.bind(prisma.adminNotification);
    const spy = vi
      .spyOn(prisma.adminNotification, "create")
      .mockImplementation(original as unknown as typeof prisma.adminNotification.create);
    spy.mockRejectedValueOnce(new Error("insert failed"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await runSalesReturnBellSweep({ returnIds: [earlier, later], now: NOW });
      expect(result).toEqual({ scanned: 2, announced: 1, deferred: 0, failed: 1, flooredNow: false });
    } finally {
      spy.mockImplementation(original as unknown as typeof prisma.adminNotification.create);
      errorSpy.mockRestore();
    }

    expect(await notificationsFor(earlier)).toHaveLength(0);
    expect(await notificationsFor(later)).toHaveLength(1);

    const retry = await runSalesReturnBellSweep({ returnIds: [earlier, later], now: NOW });
    expect(retry.announced).toBe(1);
    expect(await notificationsFor(earlier)).toHaveLength(1);
  });

  it("leaves a corrupt floor alone, warns, and announces nothing", async () => {
    await setFloor("not-a-date");
    const id = await makeReturn({ createdAt: new Date("2026-10-12T00:00:00.000Z") });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await runSalesReturnBellSweep({ returnIds: [id], now: NOW });
      expect(result).toEqual({ scanned: 0, announced: 0, deferred: 0, failed: 0, flooredNow: false });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(BELL_FLOOR_SETTING_KEY));
    } finally {
      warnSpy.mockRestore();
    }
    const floor = await prisma.systemSetting.findUnique({ where: { key: BELL_FLOOR_SETTING_KEY }, select: { value: true } });
    expect(floor?.value).toBe("not-a-date");
  });
});
