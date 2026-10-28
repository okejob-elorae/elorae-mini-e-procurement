import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

/* Creates PO/supplier/user rows — never run against the shared prod DB. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const { mockAuth, postOverride } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  postOverride: {
    fn: null as null | (() => Promise<import("@/lib/purchasing/supplier-payment-journal").PostSupplierPaymentResult>),
  },
}));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/**
 * Only the payment writer is wrapped, and only while a case sets `postOverride.fn`:
 * reaching the receipt-state codes for real needs GRNs and a mapped GL, which this
 * file deliberately never touches. Every other case, and every other export the
 * action uses (the standing-payment detector included), runs the real code.
 */
vi.mock("@/lib/purchasing/supplier-payment-journal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/purchasing/supplier-payment-journal")>();
  return {
    ...actual,
    postSupplierPaymentJournal: (...args: Parameters<typeof actual.postSupplierPaymentJournal>) =>
      postOverride.fn ? postOverride.fn() : actual.postSupplierPaymentJournal(...args),
  };
});

/* Stubbed so the toggle's post-commit fan-out cannot queue push notifications on
   the shared dev DB. The action's own durable writes — the status history row and
   any JOURNAL_PENDING flag — stay real, because they are what these cases assert
   the refusal does NOT produce. */
vi.mock("@/lib/notifications/actor-name", () => ({
  getActorName: async () => "Test Finance User",
}));
vi.mock("@/lib/notifications/events", () => ({
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
 *
 * The mark is also ABORTED when the payment writer refuses because a receipt is
 * not settled yet (`GRN_APPROVAL_PENDING`, `GRN_JOURNALS_INCOMPLETE`,
 * `GRN_REVERSAL_MISSING`): the compare-and-swap rolls back, so the PO stays
 * unpaid and nothing is flagged — including when the receipt is un-journaled
 * because of a misconfiguration at receive time. Every other post failure still
 * commits the mark and raises `JOURNAL_PENDING`, so a misconfiguration on the
 * payment post itself never blocks ops. Those cases stub the writer's result
 * through `postOverride`.
 */
d("setPOPaidAt refusals (test bed only)", () => {
  const token = Math.floor(Math.random() * 10_000_000).toString();
  let userId = "";
  let supplierTypeId = "";
  let supplierId = "";
  let apAccountId = "";
  let bankAccountId = "";
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
      if (ids.length) await prisma.adminNotification.deleteMany({ where: { id: { in: ids.map(seededId) } } });
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
          await prisma.journalLine.deleteMany({ where: { journalId: { in: ids.map(seededId) } } });
          await prisma.journal.deleteMany({ where: { id: { in: ids.map(seededId) } } });
        }
      } catch (e) {
        console.warn("[set-po-paid-at-action.test.ts] failed to delete test journals for PO", poId, e);
      }
      try {
        await prisma.pOStatusHistory.deleteMany({ where: { poId: seededId(poId) } });
      } catch (e) {
        console.warn("[set-po-paid-at-action.test.ts] failed to delete test PO history", poId, e);
      }
      try {
        await prisma.purchaseOrder.deleteMany({ where: { id: seededId(poId) } });
      } catch (e) {
        console.warn("[set-po-paid-at-action.test.ts] failed to delete test PO", poId, e);
      }
    }
    perTestPoIds = [];
  }

  beforeAll(async () => {
    userId = "";
    supplierTypeId = "";
    supplierId = "";
    apAccountId = "";
    bankAccountId = "";
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
      await prisma.chartAccount.deleteMany({ where: { id: { in: [apAccountId, bankAccountId].map(seededId) } } });
    } catch (e) {
      console.warn(
        "[set-po-paid-at-action.test.ts] failed to delete test chart accounts",
        [apAccountId, bankAccountId],
        e,
      );
    }
    try {
      await prisma.supplier.deleteMany({ where: { id: seededId(supplierId) } });
    } catch (e) {
      console.warn("[set-po-paid-at-action.test.ts] failed to delete test supplier", supplierId, e);
    }
    try {
      await prisma.supplierType.deleteMany({ where: { id: seededId(supplierTypeId) } });
    } catch (e) {
      console.warn("[set-po-paid-at-action.test.ts] failed to delete test supplier type", supplierTypeId, e);
    }
    try {
      await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    } catch (e) {
      console.warn("[set-po-paid-at-action.test.ts] failed to delete test user", userId, e);
    }
  });

  beforeEach(() => {
    postOverride.fn = null;
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

  it("refuses the mark, and writes nothing, on a PO billed through Vendor Billing", async () => {
    const poId = await seedPo("B", null);
    const uom = await prisma.uOM.create({ data: { code: `U-SPT-${token}`, nameId: "pcs", nameEn: "pcs" } });
    const item = await prisma.item.create({
      data: { sku: `SPT-${token}`, nameId: "Kain test", nameEn: "Fabric test", type: "FABRIC", uomId: uom.id, isActive: true },
    });
    const poItem = await prisma.pOItem.create({ data: { poId, itemId: item.id, qty: 10, price: 1_000, uomId: uom.id, receivedQty: 10 } });
    const bill = await prisma.vendorBill.create({
      data: {
        docNumber: `BILL-SPT-${token}`,
        supplierId,
        vendorInvoiceNo: `INV-SPT-${token}`,
        billDate: new Date(),
        total: 10_000,
        createdById: userId,
        lines: { create: { type: "PO_ITEM", poItemId: poItem.id, qty: 10, price: 1_000, amount: 10_000, refPrice: 1_000 } },
      },
    });
    try {
      const r = await setPOPaidAt(poId, new Date("2026-06-25T00:00:00.000Z"));
      expect(r).toEqual({ changed: false, refusal: "BILLED_VIA_VENDOR_BILL", journalFailure: null });
      expect(await paidAtOf(poId)).toBeNull();
      expect(await paymentJournalsFor(poId)).toEqual([]);

      // A voided bill no longer blocks the toggle.
      await prisma.vendorBill.update({ where: { id: bill.id }, data: { status: "VOID" } });
      expect((await setPOPaidAt(poId, new Date("2026-06-25T00:00:00.000Z"))).refusal).toBeNull();
    } finally {
      await prisma.vendorBillLine.deleteMany({ where: { billId: seededId(bill.id) } });
      await prisma.vendorBill.deleteMany({ where: { id: seededId(bill.id) } });
      await prisma.pOItem.deleteMany({ where: { id: seededId(poItem.id) } });
      await prisma.item.deleteMany({ where: { id: seededId(item.id) } });
      await prisma.uOM.deleteMany({ where: { id: seededId(uom.id) } });
    }
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

  it.each([
    ["GRN_APPROVAL_PENDING", "4"],
    ["GRN_JOURNALS_INCOMPLETE", "5"],
    ["GRN_REVERSAL_MISSING", "6"],
  ] as const)("aborts the mark, and writes nothing, when a receipt blocks the payment (%s)", async (code, label) => {
    const poId = await seedPo(label, null);
    postOverride.fn = async () => ({ ok: false, code });

    const r = await setPOPaidAt(poId, new Date("2026-06-25T00:00:00.000Z"));
    expect(r).toEqual({ changed: false, refusal: code, journalFailure: null });

    /* The stub only runs after the compare-and-swap has already set `paidAt`
       inside the transaction, so `paidAt` reading null here is that write rolled
       back. No audit row and no JOURNAL_PENDING flag either: nothing was marked,
       so there is no journal gap for the banner to report. */
    expect(await paidAtOf(poId)).toBeNull();
    expect(await paymentHistoryFor(poId)).toEqual([]);
    expect(await journalPendingIdsFor([poId])).toEqual([]);
    expect(await paymentJournalsFor(poId)).toEqual([]);
  });

  it("still commits the mark, and flags it, when the payment post fails on configuration", async () => {
    const poId = await seedPo("7", null);
    postOverride.fn = async () => ({ ok: false, code: "UNMAPPED_ROLE", role: "AP" });

    const r = await setPOPaidAt(poId, new Date("2026-06-25T00:00:00.000Z"));
    expect(r).toEqual({
      changed: true,
      refusal: null,
      journalFailure: { code: "UNMAPPED_ROLE", role: "AP", direction: "payment" },
    });

    expect(await paidAtOf(poId)).not.toBeNull();
    expect(await paymentHistoryFor(poId)).toEqual([{ paymentEvent: "MARKED" }]);
    expect(await journalPendingIdsFor([poId])).toHaveLength(1);
  });

  it("still commits the mark, and flags it, when the payment post throws", async () => {
    const poId = await seedPo("8", null);
    postOverride.fn = async () => {
      throw new Error("NON_POSTABLE_ACCOUNT");
    };

    const r = await setPOPaidAt(poId, new Date("2026-06-25T00:00:00.000Z"));
    expect(r).toEqual({
      changed: true,
      refusal: null,
      journalFailure: { code: "ERROR", role: null, direction: "payment" },
    });

    expect(await paidAtOf(poId)).not.toBeNull();
    expect(await paymentHistoryFor(poId)).toEqual([{ paymentEvent: "MARKED" }]);
    expect(await journalPendingIdsFor([poId])).toHaveLength(1);
  });
});
