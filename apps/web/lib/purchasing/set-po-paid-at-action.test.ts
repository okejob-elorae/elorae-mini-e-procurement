import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@elorae/db";

/* Creates PO/supplier/user rows — never run against the shared prod DB. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/* Stubbed so the toggle's post-commit fan-out cannot queue push notifications on
   the shared dev DB. The action's own durable writes — the status history row and
   any JOURNAL_PENDING flag — stay real, because they are what these cases assert
   the refusal does NOT produce. */
vi.mock("@/app/actions/notifications", () => ({
  getActorName: async () => "Test Finance User",
  notifyPOCreated: async () => {},
  notifyPOStatusUpdated: async () => {},
  notifyPOPaymentToggled: async () => {},
}));

/* The second route past that invariant: a JOURNAL_PENDING flag now fans out to the bell too. */
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

import { setPOPaidAt } from "@/app/actions/purchase-orders";

/*
 * The paid toggle refuses a MARK while the PO reads unpaid with its payment
 * journal still standing at the current generation — the state a failed reversal
 * leaves behind. Both UIs already withhold the button for it, but every
 * `"use server"` export is an independently callable endpoint, so the server has
 * to hold the same line: committing `paidAt` there makes the standing-payment
 * detector go false and drops the amber banner that carries the only control able
 * to clear the state.
 *
 * The standing payment journal is stood up by inserting it directly rather than by
 * running the payment writer, so no `JournalAccountMapping` is touched and this
 * file cannot disturb the GL config the sibling specs snapshot. Two throwaway
 * chart accounts (never mapped to a posting role) exist purely to hang those lines
 * off. The ordinary-mark case has no receipts at all, which `poBookedPayable`
 * answers with `NOTHING_TO_POST` BEFORE it resolves the AP role — so it does not
 * read the mapping either.
 */
d("setPOPaidAt standing-payment refusal (test bed only)", () => {
  const token = Math.floor(Math.random() * 10_000_000).toString();
  let userId: string;
  let supplierTypeId: string;
  let supplierId: string;
  let apAccountId: string;
  let bankAccountId: string;
  let perTestPoIds: string[] = [];

  async function seedPo(label: string, paidAt: Date | null): Promise<string> {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-SPT-${token}-${label}`, supplierId, createdById: userId, paidAt },
      select: { id: true },
    });
    perTestPoIds.push(po.id);
    return po.id;
  }

  /** The `SUPPLIER_PAYMENT` journal at generation 1 that a failed unmark leaves
      standing: on the ledger, with no reversal counted against it. */
  async function standPaymentJournal(poId: string): Promise<void> {
    await prisma.journal.create({
      data: {
        date: new Date("2026-06-20T00:00:00.000Z"),
        description: `Supplier payment ${poId}`,
        sourceType: "SUPPLIER_PAYMENT",
        sourceId: `${poId}#1`,
        postedById: userId,
        lines: {
          create: [
            { chartAccountId: apAccountId, debit: 30_000, credit: 0 },
            { chartAccountId: bankAccountId, debit: 0, credit: 30_000 },
          ],
        },
      },
    });
  }

  async function paymentJournalsFor(poId: string) {
    return prisma.journal.findMany({
      where: {
        sourceType: { in: ["SUPPLIER_PAYMENT", "SUPPLIER_PAYMENT_REVERSAL"] },
        sourceId: { startsWith: `${poId}#` },
      },
      select: { sourceType: true, sourceId: true, lines: { select: { chartAccountId: true, debit: true, credit: true } } },
    });
  }

  async function paidAtOf(poId: string): Promise<Date | null> {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: poId }, select: { paidAt: true } });
    return po?.paidAt ?? null;
  }

  async function paymentHistoryFor(poId: string) {
    return prisma.pOStatusHistory.findMany({ where: { poId }, select: { paymentEvent: true } });
  }

  /* Matched in JS on `metadata.docId`, mirroring how the notifier's own dedup
     reads these rows — JSON-path filtering is unreliable on this adapter. */
  async function journalPendingIdsFor(poIds: string[]): Promise<string[]> {
    if (poIds.length === 0) return [];
    const recent = await prisma.adminNotification.findMany({
      where: { category: "JOURNAL_PENDING" },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: { id: true, metadata: true },
    });
    const wanted = new Set(poIds);
    return recent
      .filter((n) => {
        const m = n.metadata as { docId?: string } | null;
        return m?.docId != null && wanted.has(m.docId);
      })
      .map((n) => n.id);
  }

  /**
   * Removes everything this file's per-test POs produced, scoped to those PO ids —
   * never a sweep by source type or category, which on the shared dev DB would
   * delete real payment journals and real notifications.
   */
  async function cleanupPerTestPos(): Promise<void> {
    const poIds = [...perTestPoIds];
    try {
      const ids = await journalPendingIdsFor(poIds);
      if (ids.length) await prisma.adminNotification.deleteMany({ where: { id: { in: ids } } });
    } catch (e) {
      console.warn("[set-po-paid-at-action.test.ts] failed to delete test notifications for POs", poIds, e);
    }
    for (const poId of poIds) {
      try {
        const journals = await prisma.journal.findMany({
          where: {
            sourceType: { in: ["SUPPLIER_PAYMENT", "SUPPLIER_PAYMENT_REVERSAL"] },
            sourceId: { startsWith: `${poId}#` },
          },
          select: { id: true },
        });
        const ids = journals.map((j) => j.id);
        if (ids.length) {
          await prisma.journalLine.deleteMany({ where: { journalId: { in: ids } } });
          await prisma.journal.deleteMany({ where: { id: { in: ids } } });
        }
      } catch (e) {
        console.warn("[set-po-paid-at-action.test.ts] failed to delete test journals for PO", poId, e);
      }
      try {
        await prisma.pOStatusHistory.deleteMany({ where: { poId } });
      } catch (e) {
        console.warn("[set-po-paid-at-action.test.ts] failed to delete test PO history", poId, e);
      }
      try {
        await prisma.purchaseOrder.deleteMany({ where: { id: poId } });
      } catch (e) {
        console.warn("[set-po-paid-at-action.test.ts] failed to delete test PO", poId, e);
      }
    }
    perTestPoIds = [];
  }

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `test-sp-toggle-${token}@test.local`, name: "Test Finance User" },
    });
    userId = user.id;
    const supplierType = await prisma.supplierType.create({ data: { code: `ST-SPT-${token}`, name: "Test Type" } });
    supplierTypeId = supplierType.id;
    const supplier = await prisma.supplier.create({
      data: { code: `SUP-SPT-${token}`, name: "Test Supplier", typeId: supplierTypeId },
    });
    supplierId = supplier.id;

    /* Active leaf accounts, deliberately NOT mapped to any posting role. */
    const ap = await prisma.chartAccount.create({
      data: { code: `9${token}0`, name: "AP (paid toggle test)", type: "LIABILITAS", depth: 1, isActive: true },
      select: { id: true },
    });
    apAccountId = ap.id;
    const bank = await prisma.chartAccount.create({
      data: { code: `9${token}1`, name: "Bank (paid toggle test)", type: "ASET", depth: 1, isActive: true },
      select: { id: true },
    });
    bankAccountId = bank.id;
  }, 60_000);

  /* Each step guarded so one failure cannot skip the rest, and logged so a leaked
     test row stays discoverable on the shared dev DB. */
  afterAll(async () => {
    await cleanupPerTestPos();
    try {
      await prisma.chartAccount.deleteMany({ where: { id: { in: [apAccountId, bankAccountId] } } });
    } catch (e) {
      console.warn(
        "[set-po-paid-at-action.test.ts] failed to delete test chart accounts",
        [apAccountId, bankAccountId],
        e,
      );
    }
    try {
      await prisma.supplier.deleteMany({ where: { id: supplierId } });
    } catch (e) {
      console.warn("[set-po-paid-at-action.test.ts] failed to delete test supplier", supplierId, e);
    }
    try {
      await prisma.supplierType.deleteMany({ where: { id: supplierTypeId } });
    } catch (e) {
      console.warn("[set-po-paid-at-action.test.ts] failed to delete test supplier type", supplierTypeId, e);
    }
    try {
      await prisma.user.deleteMany({ where: { id: userId } });
    } catch (e) {
      console.warn("[set-po-paid-at-action.test.ts] failed to delete test user", userId, e);
    }
  });

  beforeEach(() => {
    mockAuth.mockReset();
    mockAuth.mockResolvedValue({ user: { id: userId, permissions: ["purchase_orders:edit"] } });
  });

  afterEach(async () => {
    await cleanupPerTestPos();
  });

  it("refuses the mark, and writes nothing, while a payment journal stands on an unpaid PO", async () => {
    const poId = await seedPo("1", null);
    await standPaymentJournal(poId);

    const r = await setPOPaidAt(poId, new Date("2026-06-25T00:00:00.000Z"));
    expect(r).toEqual({ changed: false, refusal: "STANDING_PAYMENT_JOURNAL", journalFailure: null });

    /* Nothing written: not the toggle, not a journal, not the audit trail, not a
       flag. The standing payment journal seeded above is the only one left, and it
       is untouched — which is also what keeps the PO detail page's banner up. */
    expect(await paidAtOf(poId)).toBeNull();
    const journals = await paymentJournalsFor(poId);
    expect(journals.map((j) => [j.sourceType, j.sourceId])).toEqual([["SUPPLIER_PAYMENT", `${poId}#1`]]);
    expect(await paymentHistoryFor(poId)).toEqual([]);
    expect(await journalPendingIdsFor([poId])).toEqual([]);
  });

  it("still marks an ordinary unpaid PO paid", async () => {
    const poId = await seedPo("2", null);

    const r = await setPOPaidAt(poId, new Date("2026-06-25T00:00:00.000Z"));
    expect(r.refusal).toBeNull();
    expect(r.changed).toBe(true);
    /* No receipts, so nothing is bookable — the journal outcome is the honest
       `NOTHING_TO_POST`, not the refusal, and the toggle itself still commits. */
    expect(r.journalFailure).toMatchObject({ code: "NOTHING_TO_POST", direction: "payment" });

    expect(await paidAtOf(poId)).not.toBeNull();
    expect(await paymentHistoryFor(poId)).toEqual([{ paymentEvent: "MARKED" }]);
  });

  it("still unmarks a paid PO, and its reversal still reaches the ledger", async () => {
    const poId = await seedPo("3", new Date("2026-06-21T00:00:00.000Z"));
    await standPaymentJournal(poId);

    const r = await setPOPaidAt(poId, null);
    expect(r).toEqual({ changed: true, refusal: null, journalFailure: null });

    expect(await paidAtOf(poId)).toBeNull();
    expect(await paymentHistoryFor(poId)).toEqual([{ paymentEvent: "UNMARKED" }]);
    const reversal = (await paymentJournalsFor(poId)).find((j) => j.sourceType === "SUPPLIER_PAYMENT_REVERSAL");
    expect(reversal?.sourceId).toBe(`${poId}#1`);
    /* Mirrored: the payment's DR AP / CR Bank comes back as CR AP / DR Bank on the
       same two accounts, so the pair nets to zero on both. */
    expect(reversal?.lines.map((l) => ({ acc: l.chartAccountId, d: Number(l.debit), c: Number(l.credit) }))).toEqual(
      expect.arrayContaining([
        { acc: apAccountId, d: 0, c: 30_000 },
        { acc: bankAccountId, d: 30_000, c: 0 },
      ]),
    );
  });
});
