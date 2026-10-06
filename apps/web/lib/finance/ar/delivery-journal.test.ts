import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { postFieldDeliveryRevenueJournal, postFieldDeliveryCogsJournal } from "./delivery-journal";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../journals/mapping-test-fixture";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const D1 = new Date("2026-03-10T00:00:00.000+07:00");
const D2 = new Date("2026-04-10T00:00:00.000+07:00");

d("delivery journals (test bed only)", () => {
  let token = 0;
  let storeId = "";
  let userId = "";
  let orderId = "";
  let deliveryId = "";
  let arId = "";
  let revId = "";
  let cogsId = "";
  let invId = "";
  let mappingSnapshot: MappingSnapshot;

  beforeEach(async () => {
    token = Math.floor(Math.random() * 1_000_000);
    storeId = ""; userId = ""; orderId = ""; deliveryId = "";
    arId = ""; revId = ""; cogsId = ""; invId = "";
    mappingSnapshot = await snapshotMappings(["AR", "SALES_REVENUE", "COGS", "INVENTORY"]);

    const store = await prisma.store.create({
      data: { code: `TEST-DJ-${token}`, name: "test", address: "test", termsType: "PUTUS" },
    });
    storeId = store.id;
    const user = await prisma.user.create({
      data: { email: `dj-${token}@test.local`, name: "test", role: "ADMIN" },
    });
    userId = user.id;
    const order = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-DJ-ORD-${token}`, storeId, salesmanId: userId, subtotal: 1000, total: 1000 },
    });
    orderId = order.id;
    const delivery = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-DJ-DLV-${token}`,
        orderId,
        deliveredAt: D1,
        deliveredById: userId,
        invoiceDate: D1,
        dueDate: D1,
        subtotal: 1000,
        total: 1000,
        cogsAmount: 600,
      },
    });
    deliveryId = delivery.id;

    const mk = async (code: string, type: "ASET" | "PENDAPATAN" | "HPP") =>
      (await prisma.chartAccount.create({ data: { code, name: "t", type, depth: 1, isActive: true } })).id;
    arId = await mk(`9${token}1`, "ASET");
    revId = await mk(`9${token}2`, "PENDAPATAN");
    cogsId = await mk(`9${token}3`, "HPP");
    invId = await mk(`9${token}4`, "ASET");
    const map = async (role: string, id: string) =>
      prisma.journalAccountMapping.upsert({
        where: { role: role as never },
        create: { role: role as never, chartAccountId: id },
        update: { chartAccountId: id },
      });
    await map("AR", arId);
    await map("SALES_REVENUE", revId);
    await map("COGS", cogsId);
    await map("INVENTORY", invId);
  });

  afterEach(async () => {
    await restoreMappings(mappingSnapshot);
    await prisma.journalLine.deleteMany({ where: { journal: { sourceId: seededId(deliveryId) } } });
    await prisma.journal.deleteMany({ where: { sourceId: seededId(deliveryId) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: seededId(deliveryId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.chartAccount.deleteMany({
      where: { id: { in: [seededId(arId), seededId(revId), seededId(cogsId), seededId(invId)] } },
    });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
  });

  async function journalDate(sourceType: string): Promise<Date | null> {
    const j = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType, sourceId: deliveryId } },
      select: { date: true },
    });
    return j?.date ?? null;
  }

  it("waits for an in-flight date correction and dates the revenue journal on the committed invoice date", async () => {
    const { pending } = await prisma.$transaction(
      async (tx) => {
        await tx.fieldSalesDelivery.update({ where: { id: deliveryId }, data: { invoiceDate: D2 } });
        const post = postFieldDeliveryRevenueJournal(deliveryId, userId);
        /* Swallow here so an early failure is not reported as unhandled; the await below rethrows. */
        post.catch(() => undefined);
        await new Promise((r) => setTimeout(r, 500));
        /* Wrapped so the transaction does not await the post, which is blocked on this row's lock. */
        return { pending: post };
      },
      { timeout: 15000 },
    );
    const result = await pending;
    expect(result).toMatchObject({ ok: true, created: true });
    expect((await journalDate("FIELD_DELIVERY_REVENUE"))?.getTime()).toBe(D2.getTime());
  });

  it("dates the COGS journal on the delivery's current invoice date", async () => {
    await prisma.fieldSalesDelivery.update({ where: { id: deliveryId }, data: { invoiceDate: D2 } });
    const result = await postFieldDeliveryCogsJournal(deliveryId, userId);
    expect(result).toMatchObject({ ok: true, created: true });
    expect((await journalDate("FIELD_DELIVERY_COGS"))?.getTime()).toBe(D2.getTime());
  });

  it("posts revenue and COGS for the same delivery, each in its own transaction", async () => {
    const [rev, cogs] = await Promise.all([
      postFieldDeliveryRevenueJournal(deliveryId, userId),
      postFieldDeliveryCogsJournal(deliveryId, userId),
    ]);
    expect(rev).toMatchObject({ ok: true, created: true });
    expect(cogs).toMatchObject({ ok: true, created: true });
  });

  it("returns NOTHING_TO_POST for a missing delivery", async () => {
    expect(await postFieldDeliveryRevenueJournal(`missing-${token}`, userId)).toEqual({
      ok: false,
      code: "NOTHING_TO_POST",
    });
    expect(await postFieldDeliveryCogsJournal(`missing-${token}`, userId)).toEqual({
      ok: false,
      code: "NOTHING_TO_POST",
    });
  });
});
