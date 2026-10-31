import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../journals/mapping-test-fixture";

/*
 * The nota engine itself (`lib/finance/lapangan/jurnal.ts`) is tested in
 * `lib/finance/lapangan/jurnal-lapangan.test.ts`. Here its hook is a recorder, so what is pinned is
 * the routing: which delivery goes to the nota engine, and which completes the old two-journal pair.
 */
const { notaHook } = vi.hoisted(() => ({
  notaHook: { calls: [] as string[], result: null as unknown },
}));
vi.mock("@/lib/finance/lapangan/kait", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/finance/lapangan/kait")>()),
  postingNotaKait: async (deliveryId: string) => {
    notaHook.calls.push(deliveryId);
    return notaHook.result;
  },
}));

import { postFieldDeliveryRevenueJournal, postFieldDeliveryCogsJournal } from "./delivery-journal";

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
    notaHook.calls = [];
    notaHook.result = null;
    mappingSnapshot = await snapshotMappings(["AR_STORE", "SALES_REVENUE", "COGS", "INVENTORY"]);

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
    await map("AR_STORE", arId);
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

  async function journalOf(sourceType: string) {
    return prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType, sourceId: deliveryId } },
      include: { lines: true },
    });
  }

  /* A bare row stands in for a journal posted earlier; only its existence is read. */
  async function seedJournal(sourceType: string): Promise<string> {
    return (
      await prisma.journal.create({
        data: { date: D1, description: "fixture", sourceType, sourceId: deliveryId, postedById: userId },
      })
    ).id;
  }

  it("sends a delivery with no journal to the nota engine for both kinds, and never starts the old pair", async () => {
    notaHook.result = { ok: true, journalId: "nota-journal", created: true };
    expect(await postFieldDeliveryRevenueJournal(deliveryId, userId)).toEqual({ ok: true, journalId: "nota-journal", created: true });
    expect(await postFieldDeliveryCogsJournal(deliveryId, userId)).toEqual({ ok: true, journalId: "nota-journal", created: true });
    expect(notaHook.calls).toEqual([deliveryId, deliveryId]);
    expect(await journalOf("FIELD_DELIVERY_REVENUE")).toBeNull();
    expect(await journalOf("FIELD_DELIVERY_COGS")).toBeNull();
  });

  it("reports a failed nota post as NOTHING_TO_POST, so the caller files no second flag beside the engine's own", async () => {
    notaHook.result = { ok: false, code: "UNMAPPED_ROLE", role: "AR_STORE" };
    expect(await postFieldDeliveryRevenueJournal(deliveryId, userId)).toEqual({ ok: false, code: "NOTHING_TO_POST" });
    notaHook.result = null;
    expect(await postFieldDeliveryCogsJournal(deliveryId, userId)).toEqual({ ok: false, code: "NOTHING_TO_POST" });
  });

  it("returns a standing nota journal unchanged for both kinds", async () => {
    const notaId = await seedJournal("FIELD_DELIVERY");
    expect(await postFieldDeliveryRevenueJournal(deliveryId, userId)).toEqual({ ok: true, journalId: notaId, created: false });
    expect(await postFieldDeliveryCogsJournal(deliveryId, userId)).toEqual({ ok: true, journalId: notaId, created: false });
    expect(notaHook.calls).toEqual([]);
  });

  it("returns the old pair's half that already stands, without touching the nota engine", async () => {
    const revenueId = await seedJournal("FIELD_DELIVERY_REVENUE");
    expect(await postFieldDeliveryRevenueJournal(deliveryId, userId)).toEqual({ ok: true, journalId: revenueId, created: false });
    expect(notaHook.calls).toEqual([]);
  });

  it("completes the old pair's revenue half on the store receivable, dated on the invoice date an in-flight correction commits", async () => {
    await seedJournal("FIELD_DELIVERY_COGS");
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
    expect(await pending).toMatchObject({ ok: true, created: true });
    expect(notaHook.calls).toEqual([]);

    const journal = await journalOf("FIELD_DELIVERY_REVENUE");
    expect(journal?.date.getTime()).toBe(D2.getTime());
    expect(journal!.lines.find((l) => l.chartAccountId === arId)).toMatchObject({ memo: "AR_STORE", storeId });
    expect(Number(journal!.lines.find((l) => l.chartAccountId === arId)!.debit)).toBe(1000);
    expect(Number(journal!.lines.find((l) => l.chartAccountId === revId)!.credit)).toBe(1000);
  });

  it("completes the old pair's COGS half on the delivery's current invoice date", async () => {
    await seedJournal("FIELD_DELIVERY_REVENUE");
    await prisma.fieldSalesDelivery.update({ where: { id: deliveryId }, data: { invoiceDate: D2 } });
    expect(await postFieldDeliveryCogsJournal(deliveryId, userId)).toMatchObject({ ok: true, created: true });
    expect(notaHook.calls).toEqual([]);

    const journal = await journalOf("FIELD_DELIVERY_COGS");
    expect(journal?.date.getTime()).toBe(D2.getTime());
    expect(Number(journal!.lines.find((l) => l.chartAccountId === cogsId)!.debit)).toBe(600);
    expect(Number(journal!.lines.find((l) => l.chartAccountId === invId)!.credit)).toBe(600);
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
    expect(notaHook.calls).toEqual([]);
  });
});
