import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@elorae/db";
import { postPendingSalesJournals, GL_CUTOVER_SETTING_KEY } from "./sweep";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../journals/mapping-test-fixture";

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("postPendingSalesJournals (test bed only)", () => {
  let token: number;
  let userId: string;
  let orderId: string;
  let acctIds: string[];
  let mappingSnapshot: MappingSnapshot;
  let cutoverSnapshot: string | null;

  const setCutover = (value: string): Promise<unknown> =>
    prisma.systemSetting.upsert({
      where: { key: GL_CUTOVER_SETTING_KEY },
      create: { key: GL_CUTOVER_SETTING_KEY, value },
      update: { value },
    });

  beforeEach(async () => {
    token = Math.floor(Math.random() * 1_000_000);
    mappingSnapshot = await snapshotMappings(["AR", "SALES_REVENUE", "COGS", "INVENTORY"]);
    /* The sweep is fail-closed on the GL cutover floor — without a setting it selects nothing. */
    const cutoverRow = await prisma.systemSetting.findUnique({ where: { key: GL_CUTOVER_SETTING_KEY }, select: { value: true } });
    cutoverSnapshot = cutoverRow?.value ?? null;
    await setCutover("2026-01-01");
    const user = await prisma.user.create({ data: { email: `test-sales-sweep-${token}@test.local`, name: "Sweeper", role: "ADMIN" } });
    userId = user.id;
    const so = await prisma.salesOrder.create({
      data: { salesorderId: token, salesorderNo: `SO-${token}`, channel: "SHOPEE", sourceName: "t", status: "SHIPPED", subTotal: 1000, totalDisc: 0, totalTax: 0, shippingCost: 0, grandTotal: 1000, transactionDate: new Date("2026-03-05"), shippedById: userId },
      select: { id: true },
    });
    orderId = so.id;
    await prisma.salesOrderItem.create({ data: { salesOrderId: orderId, salesorderDetailId: token * 10, jubelioItemId: 1, jubelioItemCode: "x", productName: "x", qty: 1, qtyInBase: 1, unitPrice: 1000, pricePaid: 1000, discAmount: 0, taxAmount: 0, lineTotal: 1000, cogs: 400 } });

    const mk = async (code: string, type: "ASET" | "PENDAPATAN" | "HPP") =>
      (await prisma.chartAccount.create({ data: { code, name: "t", type, depth: 1, isActive: true } })).id;
    acctIds = [await mk(`9${token}1`, "ASET"), await mk(`9${token}2`, "PENDAPATAN"), await mk(`9${token}3`, "HPP"), await mk(`9${token}4`, "ASET")];
    const map = async (role: string, id: string) => prisma.journalAccountMapping.upsert({ where: { role: role as never }, create: { role: role as never, chartAccountId: id }, update: { chartAccountId: id } });
    await map("AR", acctIds[0]); await map("SALES_REVENUE", acctIds[1]); await map("COGS", acctIds[2]); await map("INVENTORY", acctIds[3]);
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

    /*
     * Shared config first — both of these are live rows the running ERP reads, and no
     * bookkeeping delete below may stand between a failure and restoring them. The step
     * name carries the value the bed should end up holding, so a failed restore names
     * its own remedy.
     */
    await step(`restoreMappings (→ ${JSON.stringify(mappingSnapshot)})`, () => restoreMappings(mappingSnapshot));
    await step(
      `restoreCutover (→ ${cutoverSnapshot === null ? "absent (no row)" : JSON.stringify(cutoverSnapshot)})`,
      () =>
        cutoverSnapshot === null
          ? prisma.systemSetting.deleteMany({ where: { key: GL_CUTOVER_SETTING_KEY } })
          : setCutover(cutoverSnapshot),
    );

    /*
     * Every own-row filter below is coalesced to a never-matching value: a beforeEach that
     * dies partway leaves these ids undefined, Prisma drops an undefined filter term, and a
     * deleteMany with an empty where clears the whole table on the shared bed.
     */
    await step("journals", async () => {
      const journals = await prisma.journal.findMany({ where: { postedById: userId ?? "" }, select: { id: true } });
      const ids = journals.map((j) => j.id);
      if (ids.length) {
        await prisma.journalLine.deleteMany({ where: { journalId: { in: ids } } });
        await prisma.journal.deleteMany({ where: { id: { in: ids } } });
      }
    });
    await step("notifications", () => prisma.adminNotification.deleteMany({ where: { category: "JOURNAL_PENDING", message: { contains: `SO-${token}` } } }));
    await step("accounts", () => prisma.chartAccount.deleteMany({ where: { id: { in: acctIds ?? [] } } }));
    await step("items", () => prisma.salesOrderItem.deleteMany({ where: { salesOrderId: orderId ?? "" } }));
    await step("orders", () => prisma.salesOrder.deleteMany({ where: { id: orderId ?? "" } }));
    await step("user", () => prisma.user.deleteMany({ where: { id: userId ?? "" } }));

    if (failures.length) throw new Error(`sales sweep spec teardown failed — ${failures.join(" | ")}`);
  });

  it("posts both journals for a shipped+consumed order, idempotently", async () => {
    const first = await postPendingSalesJournals({ limit: 100, orderIds: [orderId] });
    expect(first.revenue).toBeGreaterThanOrEqual(1);
    expect(first.cogs).toBeGreaterThanOrEqual(1);
    expect(await prisma.journal.findUnique({ where: { sourceType_sourceId: { sourceType: "SALESORDER_REVENUE", sourceId: orderId } } })).not.toBeNull();
    expect(await prisma.journal.findUnique({ where: { sourceType_sourceId: { sourceType: "SALESORDER_COGS", sourceId: orderId } } })).not.toBeNull();
    // Second run does not double-post this order.
    const before = await prisma.journal.count({ where: { sourceId: orderId } });
    await postPendingSalesJournals({ limit: 100, orderIds: [orderId] });
    expect(await prisma.journal.count({ where: { sourceId: orderId } })).toBe(before);
  });

  it("unmapped role → order stays pending + a single JOURNAL_PENDING (no dup on 2nd run)", async () => {
    await prisma.journalAccountMapping.deleteMany({ where: { role: "AR" } });
    await postPendingSalesJournals({ limit: 100, orderIds: [orderId] });
    await postPendingSalesJournals({ limit: 100, orderIds: [orderId] });
    const notifs = await prisma.adminNotification.count({ where: { category: "JOURNAL_PENDING", message: { contains: `SO-${token}` } } });
    expect(notifs).toBe(1);
    expect(await prisma.journal.findUnique({ where: { sourceType_sourceId: { sourceType: "SALESORDER_REVENUE", sourceId: orderId } } })).toBeNull();
  });
});
