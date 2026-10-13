import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { runPaymentReminderSweep } from "./payment-reminder-sweep";
import { PO_PAYMENT_DUE } from "./payment-reminder-copy";
import { PAYMENT_REMINDER_SETTING_KEY } from "./payment-reminder-thresholds";

/* Seeds supplier/PO/notification rows — never run against the shared prod DB. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
/** WIB midnight of a calendar day — the shape every PO due date is stored in. */
function wibDay(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m - 1, day) - WIB_OFFSET_MS);
}
/** 09:00 WIB on a calendar day — when the cron fires. */
function wibMorning(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m - 1, day, 2));
}
const AS_OF = wibMorning(2026, 10, 13);

type Meta = { poId?: string; thresholdDays?: number; daysRelative?: number; dueDate?: string };

async function notificationsFor(poId: string) {
  const rows = await prisma.adminNotification.findMany({
    where: { category: PO_PAYMENT_DUE },
    select: { id: true, title: true, severity: true, metadata: true },
  });
  return rows.filter((r) => (r.metadata as Meta | null)?.poId === poId);
}

d("runPaymentReminderSweep (test bed only)", () => {
  let token = "";
  let userId = "";
  let supplierTypeId = "";
  let supplierId = "";
  let poIds: string[] = [];
  /**
   * `po.paymentReminderDays` is a SHARED singleton on the `:3308` bed that the settings page
   * writes in real dev use. Snapshot it, pin the default for the run, restore it after.
   */
  let settingSnapshot: string | null = null;
  let docSeq = 0;

  async function makePo(opts: {
    paymentDueDate: Date | null;
    status?: "DRAFT" | "SUBMITTED" | "PARTIAL" | "CLOSED" | "OVER" | "CANCELLED";
    paidAt?: Date | null;
  }): Promise<string> {
    docSeq += 1;
    const po = await prisma.purchaseOrder.create({
      data: {
        docNumber: `PO-TEST-PRM-${token}-${docSeq}`,
        supplierId,
        createdById: userId,
        status: opts.status ?? "SUBMITTED",
        paymentDueDate: opts.paymentDueDate,
        paidAt: opts.paidAt ?? null,
        grandTotal: 1500000,
      },
    });
    poIds.push(po.id);
    return po.id;
  }

  beforeAll(async () => {
    userId = "";
    supplierTypeId = "";
    supplierId = "";
    token = Math.floor(Math.random() * 10_000_000).toString();
    const user = await prisma.user.create({ data: { email: `test-prm-${token}@test.local`, name: "Test PRM User" } });
    userId = user.id;
    const supplierType = await prisma.supplierType.create({ data: { code: `ST-PRM-${token}`, name: "Test Type" } });
    supplierTypeId = supplierType.id;
    const supplier = await prisma.supplier.create({
      data: { code: `SUP-PRM-${token}`, name: "Test PRM Supplier", typeId: supplierTypeId },
    });
    supplierId = supplier.id;
  }, 60_000);

  afterAll(async () => {
    try {
      await prisma.supplier.deleteMany({ where: { id: seededId(supplierId) } });
    } catch (e) {
      console.warn("[payment-reminder-sweep.test.ts] failed to delete test supplier", supplierId, e);
    }
    try {
      await prisma.supplierType.deleteMany({ where: { id: seededId(supplierTypeId) } });
    } catch (e) {
      console.warn("[payment-reminder-sweep.test.ts] failed to delete test supplier type", supplierTypeId, e);
    }
    try {
      await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    } catch (e) {
      console.warn("[payment-reminder-sweep.test.ts] failed to delete test user", userId, e);
    }
  });

  beforeEach(async () => {
    poIds = [];
    const existing = await prisma.systemSetting.findUnique({
      where: { key: PAYMENT_REMINDER_SETTING_KEY },
      select: { value: true },
    });
    settingSnapshot = existing?.value ?? null;
    await prisma.systemSetting.upsert({
      where: { key: PAYMENT_REMINDER_SETTING_KEY },
      create: { key: PAYMENT_REMINDER_SETTING_KEY, value: "-7,-1,0,7" },
      update: { value: "-7,-1,0,7" },
    });
  });

  /* Notifications before their POs; each step guarded so one failure cannot skip the rest. */
  afterEach(async () => {
    try {
      const rows = (await Promise.all(poIds.map((id) => notificationsFor(id)))).flat();
      if (rows.length > 0) await prisma.adminNotification.deleteMany({ where: { id: { in: rows.map((r) => seededId(r.id)) } } });
    } catch (e) {
      console.warn("[payment-reminder-sweep.test.ts] failed to delete test notifications", poIds, e);
    }
    try {
      await prisma.purchaseOrder.deleteMany({ where: { id: { in: poIds.map(seededId) } } });
    } catch (e) {
      console.warn("[payment-reminder-sweep.test.ts] failed to delete test POs", poIds, e);
    }
    if (settingSnapshot === null) {
      await prisma.systemSetting.deleteMany({ where: { key: PAYMENT_REMINDER_SETTING_KEY } });
    } else {
      await prisma.systemSetting.upsert({
        where: { key: PAYMENT_REMINDER_SETTING_KEY },
        create: { key: PAYMENT_REMINDER_SETTING_KEY, value: settingSnapshot },
        update: { value: settingSnapshot },
      });
    }
  });

  it("announces a PO seven days before its due date once, and a rerun adds nothing", async () => {
    const poId = await makePo({ paymentDueDate: wibDay(2026, 10, 20) });

    const first = await runPaymentReminderSweep({ poIds: [poId], asOf: AS_OF });
    expect(first).toEqual({ scanned: 1, announced: 1, deferred: 0, failed: 0 });

    const rows = await notificationsFor(poId);
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe("INFO");
    expect(rows[0].title.startsWith("Pembayaran PO PO-TEST-PRM-")).toBe(true);
    const meta = rows[0].metadata as Record<string, unknown>;
    expect(meta).toMatchObject({
      poId,
      supplierName: "Test PRM Supplier",
      dueDate: wibDay(2026, 10, 20).toISOString(),
      thresholdDays: -7,
      daysRelative: -7,
      amount: 1500000,
    });
    for (const value of Object.values(meta)) {
      expect(["string", "number"]).toContain(typeof value);
    }

    const second = await runPaymentReminderSweep({ poIds: [poId], asOf: AS_OF });
    expect(second.announced).toBe(0);
    expect(await notificationsFor(poId)).toHaveLength(1);
  });

  it("fires the due-day threshold once the day arrives", async () => {
    const poId = await makePo({ paymentDueDate: wibDay(2026, 10, 20) });
    await runPaymentReminderSweep({ poIds: [poId], asOf: AS_OF });
    const onDay = await runPaymentReminderSweep({ poIds: [poId], asOf: wibMorning(2026, 10, 20) });
    expect(onDay.announced).toBe(1);
    const thresholds = (await notificationsFor(poId)).map((r) => (r.metadata as Meta).thresholdDays).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(thresholds).toEqual([-7, 0]);
  });

  it("announces only the highest crossed threshold for a PO first seen ten days late", async () => {
    const poId = await makePo({ paymentDueDate: wibDay(2026, 10, 3) });
    const result = await runPaymentReminderSweep({ poIds: [poId], asOf: AS_OF });
    expect(result.announced).toBe(1);
    const rows = await notificationsFor(poId);
    expect(rows).toHaveLength(1);
    expect((rows[0].metadata as Meta).thresholdDays).toBe(7);
    expect((rows[0].metadata as Meta).daysRelative).toBe(10);
    expect(rows[0].severity).toBe("WARNING");
  });

  it("skips paid, cancelled, draft and undated POs", async () => {
    const ids = [
      await makePo({ paymentDueDate: wibDay(2026, 10, 3), paidAt: wibDay(2026, 10, 1) }),
      await makePo({ paymentDueDate: wibDay(2026, 10, 3), status: "CANCELLED" }),
      await makePo({ paymentDueDate: wibDay(2026, 10, 3), status: "DRAFT" }),
      await makePo({ paymentDueDate: null }),
    ];
    const result = await runPaymentReminderSweep({ poIds: ids, asOf: AS_OF });
    expect(result).toEqual({ scanned: 0, announced: 0, deferred: 0, failed: 0 });
  });

  it("announces a CLOSED PO that is still unpaid", async () => {
    const poId = await makePo({ paymentDueDate: wibDay(2026, 10, 20), status: "CLOSED" });
    const result = await runPaymentReminderSweep({ poIds: [poId], asOf: AS_OF });
    expect(result.announced).toBe(1);
  });

  it("re-arms when the due date moves after a reminder went out", async () => {
    const poId = await makePo({ paymentDueDate: wibDay(2026, 10, 20) });
    await runPaymentReminderSweep({ poIds: [poId], asOf: AS_OF });
    await prisma.purchaseOrder.update({ where: { id: poId }, data: { paymentDueDate: wibDay(2026, 10, 27) } });

    const moved = await runPaymentReminderSweep({ poIds: [poId], asOf: wibMorning(2026, 10, 20) });
    expect(moved.announced).toBe(1);
    const dueDates = (await notificationsFor(poId)).map((r) => (r.metadata as Meta).dueDate).sort();
    expect(dueDates).toEqual([wibDay(2026, 10, 20).toISOString(), wibDay(2026, 10, 27).toISOString()]);
  });

  it("defers past the cap, earliest due first", async () => {
    const later = await makePo({ paymentDueDate: wibDay(2026, 10, 15) });
    const earlier = await makePo({ paymentDueDate: wibDay(2026, 10, 14) });
    const result = await runPaymentReminderSweep({ poIds: [later, earlier], asOf: AS_OF, maxAnnouncementsPerRun: 1 });
    expect(result).toEqual({ scanned: 2, announced: 1, deferred: 1, failed: 0 });
    expect(await notificationsFor(earlier)).toHaveLength(1);
    expect(await notificationsFor(later)).toHaveLength(0);
  });

  it("keeps going when one PO's write fails, and retries it next run", async () => {
    const earlier = await makePo({ paymentDueDate: wibDay(2026, 10, 14) });
    const later = await makePo({ paymentDueDate: wibDay(2026, 10, 15) });

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
      const result = await runPaymentReminderSweep({ poIds: [earlier, later], asOf: AS_OF });
      expect(result).toEqual({ scanned: 2, announced: 1, deferred: 0, failed: 1 });
    } finally {
      spy.mockImplementation(original as unknown as typeof prisma.adminNotification.create);
      errorSpy.mockRestore();
    }

    expect(await notificationsFor(earlier)).toHaveLength(0);
    expect(await notificationsFor(later)).toHaveLength(1);

    const retry = await runPaymentReminderSweep({ poIds: [earlier, later], asOf: AS_OF });
    expect(retry.announced).toBe(1);
    expect(await notificationsFor(earlier)).toHaveLength(1);
  });
});
