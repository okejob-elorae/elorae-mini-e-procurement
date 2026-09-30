import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

/**
 * A pass-through spy on the real helper, so every case still runs it, `VITEST` guard included. The
 * failure case replaces it for one receivable. Stubbed at the module, never on a Prisma delegate.
 */
vi.mock("@/lib/notifications/recipients", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/recipients")>();
  return { ...actual, sendNotificationToUsers: vi.fn(actual.sendNotificationToUsers) };
});
import { sendNotificationToUsers } from "@/lib/notifications/recipients";
import { runOverdueSweep } from "./overdue-sweep";
import { OVERDUE_THRESHOLD_SETTING_KEY } from "./overdue-thresholds";

const actualRecipients = await vi.importActual<typeof import("@/lib/notifications/recipients")>("@/lib/notifications/recipients");

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const DAY_MS = 24 * 60 * 60 * 1000;
/** WIB midnight anchor so a fixed offset in days lands on the day this test expects, regardless of host TZ. */
function daysAgoWib(days: number): Date {
  const now = new Date();
  const wibNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const wibMidnight = new Date(Date.UTC(wibNow.getUTCFullYear(), wibNow.getUTCMonth(), wibNow.getUTCDate()));
  return new Date(wibMidnight.getTime() - 7 * 60 * 60 * 1000 - days * DAY_MS);
}

async function notificationsFor(receivableId: string) {
  const rows = await prisma.adminNotification.findMany({
    where: { category: "AR_OVERDUE" },
    select: { id: true, metadata: true },
  });
  return rows.filter((r) => (r.metadata as { receivableId?: string } | null)?.receivableId === receivableId);
}

d("runOverdueSweep (test bed only)", () => {
  let token = "";
  let storeId = "";
  let adminId = "";
  let collectorId = "";
  let orderId = "";
  let deliveryId = "";
  let receivableId = "";
  let extraDeliveryId = "";
  let extraReceivableId = "";
  /**
   * `ar.overdueThresholdDays` is a SHARED singleton row on the `:3308` bed, and the settings page
   * this slice ships writes it in real dev use. Snapshot before any test touches it, restore after
   * — an unconditional delete in teardown would silently revert an operator's configured schedule
   * (`parseOverdueThresholds` fails OPEN, so nothing would ever surface the loss).
   */
  let settingSnapshot: string | null = null;

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = ""; adminId = ""; collectorId = ""; orderId = ""; deliveryId = ""; receivableId = "";
    extraDeliveryId = ""; extraReceivableId = "";
    vi.mocked(sendNotificationToUsers).mockReset();
    vi.mocked(sendNotificationToUsers).mockImplementation(actualRecipients.sendNotificationToUsers);

    const existingSetting = await prisma.systemSetting.findUnique({
      where: { key: OVERDUE_THRESHOLD_SETTING_KEY },
      select: { value: true },
    });
    settingSnapshot = existingSetting?.value ?? null;

    const store = await prisma.store.create({ data: { code: `TEST-OSW-${token}`, name: "test", address: "test", termsType: "PUTUS" } });
    storeId = store.id;
    const admin = await prisma.user.create({ data: { email: `osw-admin-${token}@test.local`, name: "admin", role: "ADMIN" } });
    adminId = admin.id;
    const collector = await prisma.user.create({ data: { email: `osw-collector-${token}@test.local`, name: "collector", role: "ADMIN" } });
    collectorId = collector.id;
    const order = await prisma.fieldSalesOrder.create({ data: { orderNo: `TEST-OSW-ORD-${token}`, storeId, salesmanId: adminId, subtotal: 1000, total: 1000 } });
    orderId = order.id;
    const delivery = await prisma.fieldSalesDelivery.create({ data: { docNo: `TEST-OSW-DLV-${token}`, orderId, deliveredAt: new Date(), deliveredById: adminId, invoiceDate: new Date(), dueDate: daysAgoWib(45), subtotal: 1000, total: 1000 } });
    deliveryId = delivery.id;
    const receivable = await prisma.receivable.create({ data: { deliveryId, storeId, invoiceDate: new Date(), dueDate: daysAgoWib(45), originalAmount: 1000, outstandingAmount: 1000, collectorId } });
    receivableId = receivable.id;
  });

  afterEach(async () => {
    const notifs = [...(await notificationsFor(receivableId)), ...(await notificationsFor(extraReceivableId))];
    if (notifs.length > 0) await prisma.adminNotification.deleteMany({ where: { id: { in: notifs.map((n) => n.id) } } });
    await prisma.receivable.deleteMany({ where: { id: { in: [seededId(receivableId), seededId(extraReceivableId)] } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: [seededId(deliveryId), seededId(extraDeliveryId)] } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(adminId), seededId(collectorId)] } } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    if (settingSnapshot === null) {
      await prisma.systemSetting.deleteMany({ where: { key: OVERDUE_THRESHOLD_SETTING_KEY } });
    } else {
      await prisma.systemSetting.upsert({
        where: { key: OVERDUE_THRESHOLD_SETTING_KEY },
        create: { key: OVERDUE_THRESHOLD_SETTING_KEY, value: settingSnapshot },
        update: { value: settingSnapshot },
      });
    }
  });

  it("a receivable 45 days overdue fires ONCE at threshold 30, not at 0/7/30", async () => {
    const result = await runOverdueSweep({ receivableIds: [receivableId] });
    expect(result.announced).toBe(1);
    const notifs = await notificationsFor(receivableId);
    expect(notifs).toHaveLength(1);
    const meta = notifs[0].metadata as { thresholdDays: number };
    expect(meta.thresholdDays).toBe(30);
  });

  it("a second sweep the same day announces nothing more", async () => {
    await runOverdueSweep({ receivableIds: [receivableId] });
    const second = await runOverdueSweep({ receivableIds: [receivableId] });
    expect(second.announced).toBe(0);
    const notifs = await notificationsFor(receivableId);
    expect(notifs).toHaveLength(1);
  });

  it("ageing from 45 to 65 days fires again at the higher threshold", async () => {
    await runOverdueSweep({ receivableIds: [receivableId] });
    await prisma.receivable.update({ where: { id: receivableId }, data: { dueDate: daysAgoWib(65) } });
    const second = await runOverdueSweep({ receivableIds: [receivableId] });
    expect(second.announced).toBe(1);
    const notifs = await notificationsFor(receivableId);
    expect(notifs).toHaveLength(2);
    const thresholds = notifs.map((n) => (n.metadata as { thresholdDays: number }).thresholdDays).sort((a, b) => a - b);
    expect(thresholds).toEqual([30, 60]);
  });

  it("excludes a PAID receivable", async () => {
    await prisma.receivable.update({ where: { id: receivableId }, data: { status: "PAID", outstandingAmount: 0 } });
    const result = await runOverdueSweep({ receivableIds: [receivableId] });
    expect(result.scanned).toBe(0);
    expect(result.announced).toBe(0);
  });

  it("excludes a WRITTEN_OFF receivable", async () => {
    await prisma.receivable.update({ where: { id: receivableId }, data: { status: "WRITTEN_OFF" } });
    const result = await runOverdueSweep({ receivableIds: [receivableId] });
    expect(result.scanned).toBe(0);
  });

  it("a partial payment does not change dueDate and does not re-fire the same threshold", async () => {
    await runOverdueSweep({ receivableIds: [receivableId] });
    await prisma.receivable.update({ where: { id: receivableId }, data: { status: "PARTIAL", outstandingAmount: 400, paidAmount: 600 } });
    const second = await runOverdueSweep({ receivableIds: [receivableId] });
    expect(second.announced).toBe(0);
  });

  it("an unassigned receivable is still announced to admins, with zero collectors notified", async () => {
    await prisma.receivable.update({ where: { id: receivableId }, data: { collectorId: null } });
    const result = await runOverdueSweep({ receivableIds: [receivableId] });
    expect(result.announced).toBe(1);
    expect(result.collectorNotified).toBe(0);
    expect(result.unassigned).toBe(1);
    const notifs = await notificationsFor(receivableId);
    const meta = notifs[0].metadata as { collectorId: string };
    expect(meta.collectorId).toBe("");
  });

  it("a due-date correction pushing the invoice back to not-yet-due fires nothing", async () => {
    await runOverdueSweep({ receivableIds: [receivableId] });
    await prisma.receivable.update({ where: { id: receivableId }, data: { dueDate: daysAgoWib(-5) } });
    const second = await runOverdueSweep({ receivableIds: [receivableId] });
    expect(second.announced).toBe(0);
    expect(second.scanned).toBe(1);
  });

  it("respects a custom threshold list from SystemSetting", async () => {
    /* upsert, not create: the bed may already hold an operator-configured row, which afterEach now restores instead of deleting. */
    await prisma.systemSetting.upsert({
      where: { key: OVERDUE_THRESHOLD_SETTING_KEY },
      create: { key: OVERDUE_THRESHOLD_SETTING_KEY, value: "0,10" },
      update: { value: "0,10" },
    });
    const result = await runOverdueSweep({ receivableIds: [receivableId] });
    const notifs = await notificationsFor(receivableId);
    expect(result.announced).toBe(1);
    expect((notifs[0].metadata as { thresholdDays: number }).thresholdDays).toBe(10);
  });

  it("caps announcements per run and reports the remainder as deferred", async () => {
    const result = await runOverdueSweep({ receivableIds: [receivableId], maxAnnouncementsPerRun: 0 });
    expect(result.announced).toBe(0);
    expect(result.deferred).toBe(1);
    const notifs = await notificationsFor(receivableId);
    expect(notifs).toHaveLength(0);
  });

  /**
   * Regression guard for `sendNotificationToUsers`' own `if (process.env.VITEST) return;`, reached
   * end to end: the sweep's collector push calls the real helper (the spy passes through), so the
   * zero below is the helper's guard at work, not a skipped call. Every other assertion in this
   * file passes identically with or without that line — `collectorNotified` counts intent, not
   * delivery — so removing it would write permanent orphaned `NotificationQueue` rows on the shared
   * bed with no test turning red. This one turns red.
   */
  it("does not write a real NotificationQueue row for the collector under VITEST", async () => {
    const result = await runOverdueSweep({ receivableIds: [receivableId] });
    expect(result.collectorNotified).toBe(1);
    expect(vi.mocked(sendNotificationToUsers)).toHaveBeenCalledTimes(1);
    const queueRows = await prisma.notificationQueue.count({ where: { userId: collectorId } });
    expect(queueRows).toBe(0);
  });

  it("a receivable whose collector notify throws is logged and left unannounced, and the run carries on", async () => {
    /* Due earlier than the fixture's receivable, so oldest-due-first processes it FIRST: a loop that halted on it would never reach the other one. */
    const extraDelivery = await prisma.fieldSalesDelivery.create({ data: { docNo: `TEST-OSW-DLV2-${token}`, orderId, deliveredAt: new Date(), deliveredById: adminId, invoiceDate: new Date(), dueDate: daysAgoWib(50), subtotal: 1000, total: 1000 } });
    extraDeliveryId = extraDelivery.id;
    const extraReceivable = await prisma.receivable.create({ data: { deliveryId: extraDeliveryId, storeId, invoiceDate: new Date(), dueDate: daysAgoWib(50), originalAmount: 1000, outstandingAmount: 1000, collectorId } });
    extraReceivableId = extraReceivable.id;
    const scope = [extraReceivableId, receivableId];

    vi.mocked(sendNotificationToUsers).mockImplementation(async (users, payload) => {
      if (payload.data.receivableId === extraReceivableId) throw new Error("NotificationQueue insert failed");
      return actualRecipients.sendNotificationToUsers(users, payload);
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const first = await runOverdueSweep({ receivableIds: scope });
      expect(vi.mocked(sendNotificationToUsers).mock.calls.map(([, payload]) => payload.data.receivableId)).toEqual(scope);
      expect(first).toMatchObject({ scanned: 2, announced: 1, collectorNotified: 1, failed: 1 });
      expect(await notificationsFor(extraReceivableId)).toHaveLength(0);
      expect(await notificationsFor(receivableId)).toHaveLength(1);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      vi.mocked(sendNotificationToUsers).mockImplementation(actualRecipients.sendNotificationToUsers);
      errorSpy.mockRestore();
    }

    /* No marker was written for the failed crossing, so the next run retries it — and only it. */
    const second = await runOverdueSweep({ receivableIds: scope });
    expect(second).toMatchObject({ scanned: 2, announced: 1, collectorNotified: 1, failed: 0 });
    expect(await notificationsFor(extraReceivableId)).toHaveLength(1);
    expect(await notificationsFor(receivableId)).toHaveLength(1);
  });
});
