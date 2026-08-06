import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { postPendingSalesJournals, GL_CUTOVER_SETTING_KEY } from "./sweep";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../journals/mapping-test-fixture";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const CUTOVER = "2026-06-01";

/*
 * Every call to postPendingSalesJournals below is scoped with `orderIds` to this
 * spec's own seeded rows. The sweep is DB-wide by default and the test bed is the
 * shared :3308 dev database — an unscoped call would journal real orders against
 * the throwaway chart accounts created here.
 */
d("postPendingSalesJournals — GL cutover floor (test bed only)", () => {
  let token: number;
  let userId: string;
  let acctIds: string[];
  let orderIds: Record<"before" | "boundary" | "after" | "nullBefore" | "nullAfter", string>;
  let mappingSnapshot: MappingSnapshot;
  let cutoverSnapshot: string | null;

  const seedOrder = async (
    seq: number,
    label: string,
    transactionDate: Date,
    shippedAt: Date | null,
  ): Promise<string> => {
    const so = await prisma.salesOrder.create({
      data: {
        salesorderId: token * 10 + seq,
        salesorderNo: `SO-CUT-${token}-${label}`,
        channel: "SHOPEE",
        sourceName: "t",
        status: "COMPLETED",
        subTotal: 1000,
        totalDisc: 0,
        totalTax: 0,
        shippingCost: 0,
        grandTotal: 1000,
        transactionDate,
        shippedAt,
        shippedById: userId,
      },
      select: { id: true },
    });
    await prisma.salesOrderItem.create({
      data: {
        salesOrderId: so.id,
        salesorderDetailId: token * 100 + seq,
        jubelioItemId: 1,
        jubelioItemCode: "x",
        productName: "x",
        qty: 1,
        qtyInBase: 1,
        unitPrice: 1000,
        pricePaid: 1000,
        discAmount: 0,
        taxAmount: 0,
        lineTotal: 1000,
        cogs: 400,
      },
    });
    return so.id;
  };

  const setCutover = async (value: string): Promise<void> => {
    await prisma.systemSetting.upsert({
      where: { key: GL_CUTOVER_SETTING_KEY },
      create: { key: GL_CUTOVER_SETTING_KEY, value },
      update: { value },
    });
  };

  const journalCount = (orderId: string): Promise<number> =>
    prisma.journal.count({ where: { sourceId: orderId } });

  beforeEach(async () => {
    token = Math.floor(Math.random() * 1_000_000);
    mappingSnapshot = await snapshotMappings(["AR", "SALES_REVENUE", "COGS", "INVENTORY"]);
    const setting = await prisma.systemSetting.findUnique({
      where: { key: GL_CUTOVER_SETTING_KEY },
      select: { value: true },
    });
    cutoverSnapshot = setting?.value ?? null;

    const user = await prisma.user.create({
      data: { email: `test-gl-cutover-${token}@test.local`, name: "Cutover", role: "ADMIN" },
    });
    userId = user.id;

    orderIds = {
      /* One millisecond before WIB midnight on the cutover day. */
      before: await seedOrder(1, "before", new Date("2026-05-31T08:00:00.000+07:00"), new Date("2026-05-31T23:59:59.999+07:00")),
      /* Exactly WIB midnight on the cutover day — inclusive, must post. */
      boundary: await seedOrder(2, "boundary", new Date("2026-05-30T08:00:00.000+07:00"), new Date("2026-06-01T00:00:00.000+07:00")),
      after: await seedOrder(3, "after", new Date("2026-06-14T08:00:00.000+07:00"), new Date("2026-06-15T10:00:00.000+07:00")),
      /* COMPLETED with no ship stamp — the floor has to fall back to transactionDate. */
      nullBefore: await seedOrder(4, "nullbefore", new Date("2026-05-20T10:00:00.000+07:00"), null),
      nullAfter: await seedOrder(5, "nullafter", new Date("2026-06-20T10:00:00.000+07:00"), null),
    };

    const types = ["ASET", "PENDAPATAN", "HPP", "ASET"] as const;
    acctIds = [];
    for (const [i, type] of types.entries()) {
      const acct = await prisma.chartAccount.create({
        data: { code: `9${token}${i + 1}`, name: "t", type, depth: 1, isActive: true },
      });
      acctIds.push(acct.id);
    }
    const map = async (role: string, id: string) =>
      prisma.journalAccountMapping.upsert({
        where: { role: role as never },
        create: { role: role as never, chartAccountId: id },
        update: { chartAccountId: id },
      });
    await map("AR", acctIds[0]);
    await map("SALES_REVENUE", acctIds[1]);
    await map("COGS", acctIds[2]);
    await map("INVENTORY", acctIds[3]);

    await setCutover(CUTOVER);
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

    /* Shared config first — a later failure must not leave live GL config pointing at test rows. */
    await step("restoreMappings", () => restoreMappings(mappingSnapshot));
    await step("restoreCutover", async () => {
      if (cutoverSnapshot === null) {
        await prisma.systemSetting.deleteMany({ where: { key: GL_CUTOVER_SETTING_KEY } });
      } else {
        await setCutover(cutoverSnapshot);
      }
    });

    const ids = Object.values(orderIds ?? {});
    await step("journals", async () => {
      const journals = await prisma.journal.findMany({ where: { postedById: userId }, select: { id: true } });
      const journalIds = journals.map((j) => j.id);
      if (journalIds.length) {
        await prisma.journalLine.deleteMany({ where: { journalId: { in: journalIds } } });
        await prisma.journal.deleteMany({ where: { id: { in: journalIds } } });
      }
    });
    await step("notifications", () =>
      prisma.adminNotification.deleteMany({
        where: { category: "JOURNAL_PENDING", message: { contains: `SO-CUT-${token}-` } },
      }),
    );
    await step("items", () => prisma.salesOrderItem.deleteMany({ where: { salesOrderId: { in: ids } } }));
    await step("orders", () => prisma.salesOrder.deleteMany({ where: { id: { in: ids } } }));
    await step("accounts", () => prisma.chartAccount.deleteMany({ where: { id: { in: acctIds } } }));
    await step("user", () => prisma.user.deleteMany({ where: { id: userId } }));

    if (failures.length) throw new Error(`cutover spec teardown failed — ${failures.join(" | ")}`);
  });

  it("no cutover configured → selects nothing, posts nothing, reports NO_CUTOVER", async () => {
    await prisma.systemSetting.deleteMany({ where: { key: GL_CUTOVER_SETTING_KEY } });
    const res = await postPendingSalesJournals({ limit: 100, orderIds: [orderIds.after] });
    expect(res).toEqual({ posted: 0, revenue: 0, cogs: 0, pending: 0, skipped: "NO_CUTOVER" });
    expect(await journalCount(orderIds.after)).toBe(0);
  });

  it("unparseable cutover → posts nothing, reports NO_CUTOVER", async () => {
    await setCutover("bukan-tanggal");
    const res = await postPendingSalesJournals({ limit: 100, orderIds: [orderIds.after] });
    expect(res).toEqual({ posted: 0, revenue: 0, cogs: 0, pending: 0, skipped: "NO_CUTOVER" });
    expect(await journalCount(orderIds.after)).toBe(0);
  });

  it("empty cutover → posts nothing, reports NO_CUTOVER", async () => {
    await setCutover("   ");
    const res = await postPendingSalesJournals({ limit: 100, orderIds: [orderIds.after] });
    expect(res.skipped).toBe("NO_CUTOVER");
    expect(await journalCount(orderIds.after)).toBe(0);
  });

  it("order shipped before the cutover is skipped", async () => {
    const res = await postPendingSalesJournals({ limit: 100, orderIds: [orderIds.before] });
    expect(res).toEqual({ posted: 0, revenue: 0, cogs: 0, pending: 0, skipped: null });
    expect(await journalCount(orderIds.before)).toBe(0);
  });

  it("order shipped exactly at WIB midnight on the cutover date is posted", async () => {
    const res = await postPendingSalesJournals({ limit: 100, orderIds: [orderIds.boundary] });
    expect(res.skipped).toBeNull();
    expect(res.revenue).toBe(1);
    expect(res.cogs).toBe(1);
    expect(await journalCount(orderIds.boundary)).toBe(2);
  });

  it("order shipped after the cutover is posted", async () => {
    const res = await postPendingSalesJournals({ limit: 100, orderIds: [orderIds.after] });
    expect(res.revenue).toBe(1);
    expect(res.cogs).toBe(1);
    expect(await journalCount(orderIds.after)).toBe(2);
  });

  it("a scoped orderIds call cannot smuggle a pre-cutover order past the floor", async () => {
    const res = await postPendingSalesJournals({ limit: 100, orderIds: [orderIds.before, orderIds.after] });
    expect(res.revenue).toBe(1);
    expect(res.cogs).toBe(1);
    expect(await journalCount(orderIds.before)).toBe(0);
    expect(await journalCount(orderIds.after)).toBe(2);
  });

  it("no ship stamp → the floor falls back to transactionDate (pre-cutover skipped, post-cutover posted)", async () => {
    const res = await postPendingSalesJournals({
      limit: 100,
      orderIds: [orderIds.nullBefore, orderIds.nullAfter],
    });
    expect(res.revenue).toBe(1);
    expect(res.cogs).toBe(1);
    expect(await journalCount(orderIds.nullBefore)).toBe(0);
    expect(await journalCount(orderIds.nullAfter)).toBe(2);
  });
});
