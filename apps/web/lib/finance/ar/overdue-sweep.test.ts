import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { runOverdueSweep } from "./overdue-sweep";
import { OVERDUE_THRESHOLD_SETTING_KEY } from "./overdue-thresholds";

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

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = ""; adminId = ""; collectorId = ""; orderId = ""; deliveryId = ""; receivableId = "";

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
    const notifs = await notificationsFor(receivableId);
    if (notifs.length > 0) await prisma.adminNotification.deleteMany({ where: { id: { in: notifs.map((n) => n.id) } } });
    await prisma.receivable.deleteMany({ where: { id: seededId(receivableId) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: seededId(deliveryId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(adminId), seededId(collectorId)] } } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.systemSetting.deleteMany({ where: { key: OVERDUE_THRESHOLD_SETTING_KEY } });
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
    await prisma.systemSetting.create({ data: { key: OVERDUE_THRESHOLD_SETTING_KEY, value: "0,10" } });
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
});
