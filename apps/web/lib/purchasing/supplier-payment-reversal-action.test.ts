import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@elorae/db";

/* Creates PO/supplier/user rows — never run against the shared prod DB. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { postSupplierPaymentReversalJournalAction } from "@/app/actions/purchase-orders";

/*
 * The standing-payment reversal retry is the one control on this flow that is not
 * the paid toggle, so its guards are what stop it from posting a reversal for a
 * PO that does not need one. Both are asserted here because the warning banner's
 * visibility cannot be one: this action is an independently callable endpoint.
 *
 * The refusal cases post nothing. The cases that DO reach the writer stand up a
 * payment journal by inserting it directly rather than by running the payment
 * writer, because the reversal mirrors the standing journal's own chart accounts
 * instead of resolving posting roles — so no `JournalAccountMapping` is touched
 * and this file still cannot disturb the GL config the sibling spec snapshots.
 * Two throwaway chart accounts are created (never mapped) purely to hang those
 * lines off.
 */
d("postSupplierPaymentReversalJournalAction (test bed only)", () => {
  const token = Math.floor(Math.random() * 10_000_000).toString();
  let userId: string;
  let supplierTypeId: string;
  let supplierId: string;
  let unpaidPoId: string;
  let paidPoId: string;
  let apAccountId: string;
  let bankAccountId: string;
  let perTestPoIds: string[] = [];

  /**
   * A PO plus the `SUPPLIER_PAYMENT` journal at generation 1 that a failed unmark
   * leaves standing: `paidAt` cleared, the payment still on the ledger, no
   * reversal. `paidAt` is a parameter because the race this action's guards exist
   * for ends with the PO reading PAID again while that journal still stands.
   */
  async function seedPoWithStandingPayment(label: string, paidAt: Date | null): Promise<string> {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-SPR-${token}-${label}`, supplierId, createdById: userId, paidAt },
      select: { id: true },
    });
    perTestPoIds.push(po.id);
    await prisma.journal.create({
      data: {
        date: new Date("2026-06-20T00:00:00.000Z"),
        description: `Supplier payment PO-SPR-${token}-${label}`,
        sourceType: "SUPPLIER_PAYMENT",
        sourceId: `${po.id}#1`,
        postedById: userId,
        lines: {
          create: [
            { chartAccountId: apAccountId, debit: 30_000, credit: 0 },
            { chartAccountId: bankAccountId, debit: 0, credit: 30_000 },
          ],
        },
      },
    });
    return po.id;
  }

  async function reversalJournalFor(poId: string) {
    return prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT_REVERSAL", sourceId: `${poId}#1` } },
      include: { lines: { select: { chartAccountId: true, debit: true, credit: true } } },
    });
  }

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `test-sp-reversal-${token}@test.local`, name: "Test Finance User" },
    });
    userId = user.id;
    const supplierType = await prisma.supplierType.create({ data: { code: `ST-SPR-${token}`, name: "Test Type" } });
    supplierTypeId = supplierType.id;
    const supplier = await prisma.supplier.create({
      data: { code: `SUP-SPR-${token}`, name: "Test Supplier", typeId: supplierTypeId },
    });
    supplierId = supplier.id;

    /* Unpaid with no journal of any kind, and paid with no journal either: two
       different ways the state the action requires does NOT hold. */
    const unpaid = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-SPR-${token}-1`, supplierId, createdById: userId },
      select: { id: true },
    });
    unpaidPoId = unpaid.id;
    const paid = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-SPR-${token}-2`, supplierId, createdById: userId, paidAt: new Date("2026-06-10T00:00:00.000Z") },
      select: { id: true },
    });
    paidPoId = paid.id;

    /* Active leaf accounts, deliberately NOT mapped to any posting role. */
    const ap = await prisma.chartAccount.create({
      data: { code: `8${token}0`, name: "AP (reversal action test)", type: "LIABILITAS", depth: 1, isActive: true },
      select: { id: true },
    });
    apAccountId = ap.id;
    const bank = await prisma.chartAccount.create({
      data: { code: `8${token}1`, name: "Bank (reversal action test)", type: "ASET", depth: 1, isActive: true },
      select: { id: true },
    });
    bankAccountId = bank.id;
  }, 60_000);

  /**
   * Removes every journal this file's per-test POs produced, scoped to those PO
   * ids — never a sweep by source type, which on the shared dev DB would delete
   * real payment journals. Lines go first: `JournalLine` cascades on delete, but
   * deleting them explicitly keeps the order safe if that ever changes.
   */
  async function cleanupPerTestPos(): Promise<void> {
    for (const poId of perTestPoIds) {
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
        console.warn("[supplier-payment-reversal-action.test.ts] failed to delete test journals for PO", poId, e);
      }
      try {
        await prisma.purchaseOrder.deleteMany({ where: { id: poId } });
      } catch (e) {
        console.warn("[supplier-payment-reversal-action.test.ts] failed to delete test PO", poId, e);
      }
    }
    perTestPoIds = [];
  }

  /* Each step guarded so one failure cannot skip the rest, and logged so a
     leaked test row stays discoverable on the shared dev DB. */
  afterAll(async () => {
    await cleanupPerTestPos();
    try {
      await prisma.purchaseOrder.deleteMany({ where: { id: { in: [unpaidPoId, paidPoId] } } });
    } catch (e) {
      console.warn("[supplier-payment-reversal-action.test.ts] failed to delete test POs", [unpaidPoId, paidPoId], e);
    }
    try {
      await prisma.chartAccount.deleteMany({ where: { id: { in: [apAccountId, bankAccountId] } } });
    } catch (e) {
      console.warn(
        "[supplier-payment-reversal-action.test.ts] failed to delete test chart accounts",
        [apAccountId, bankAccountId],
        e,
      );
    }
    try {
      await prisma.supplier.deleteMany({ where: { id: supplierId } });
    } catch (e) {
      console.warn("[supplier-payment-reversal-action.test.ts] failed to delete test supplier", supplierId, e);
    }
    try {
      await prisma.supplierType.deleteMany({ where: { id: supplierTypeId } });
    } catch (e) {
      console.warn("[supplier-payment-reversal-action.test.ts] failed to delete test supplier type", supplierTypeId, e);
    }
    try {
      await prisma.user.deleteMany({ where: { id: userId } });
    } catch (e) {
      console.warn("[supplier-payment-reversal-action.test.ts] failed to delete test user", userId, e);
    }
  });

  beforeEach(() => {
    mockAuth.mockReset();
    mockAuth.mockResolvedValue({ user: { id: userId, permissions: ["journals:manage"] } });
  });

  /* The net for the per-test POs and their journals, so a posted reversal in one
     case cannot change what the next one reads. */
  afterEach(async () => {
    await cleanupPerTestPos();
  });

  it("refuses BAD_STATE for an unpaid PO with no standing payment journal", async () => {
    const r = await postSupplierPaymentReversalJournalAction(unpaidPoId);
    expect(r).toEqual({ ok: false, code: "BAD_STATE" });
  });

  it("refuses BAD_STATE for a PO that is marked paid", async () => {
    const r = await postSupplierPaymentReversalJournalAction(paidPoId);
    expect(r).toEqual({ ok: false, code: "BAD_STATE" });
  });

  it("refuses BAD_STATE for a PO that does not exist", async () => {
    const r = await postSupplierPaymentReversalJournalAction(`missing-${token}`);
    expect(r).toEqual({ ok: false, code: "BAD_STATE" });
  });

  it("refuses FORBIDDEN without journals:manage, before any state read", async () => {
    mockAuth.mockResolvedValue({ user: { id: userId, permissions: ["purchase_orders:edit"] } });
    const r = await postSupplierPaymentReversalJournalAction(unpaidPoId);
    expect(r).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("refuses FORBIDDEN without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const r = await postSupplierPaymentReversalJournalAction(unpaidPoId);
    expect(r).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("posts the mirrored reversal for a PO left unpaid with its payment journal standing", async () => {
    const poId = await seedPoWithStandingPayment("3", null);

    const r = await postSupplierPaymentReversalJournalAction(poId);
    expect(r).toMatchObject({ ok: true, created: true });

    const reversal = await reversalJournalFor(poId);
    expect(reversal).not.toBeNull();
    /* Mirrored: the payment's DR AP / CR Bank comes back as CR AP / DR Bank on
       the same two accounts, so the pair nets to zero on both. */
    expect(reversal?.lines.map((l) => ({ acc: l.chartAccountId, d: Number(l.debit), c: Number(l.credit) }))).toEqual(
      expect.arrayContaining([
        { acc: apAccountId, d: 0, c: 30_000 },
        { acc: bankAccountId, d: 30_000, c: 0 },
      ]),
    );
  });

  /*
   * The end state of the race this action's two layers of guard exist for: a
   * concurrent `setPOPaidAt(paidAt)` CAS-succeeds while the payment journal is
   * still standing, treats it as an idempotent same-amount hit and reports a clean
   * payment. Posting the reversal on top of that would leave the PO reading PAID
   * with payables owed again and bank restored — the inverse of the bug this
   * control repairs — so the action must refuse and write nothing.
   */
  it("refuses BAD_STATE, and posts nothing, for a PO re-marked paid while its payment journal still stands", async () => {
    const poId = await seedPoWithStandingPayment("4", new Date("2026-06-21T00:00:00.000Z"));

    const r = await postSupplierPaymentReversalJournalAction(poId);
    expect(r).toEqual({ ok: false, code: "BAD_STATE" });
    expect(await reversalJournalFor(poId)).toBeNull();
  });

  /*
   * A thrown post must come back as a named failure, not as a rejected action.
   * `postJournal` raises `NON_POSTABLE_ACCOUNT` when a line's chart account is no
   * longer an active leaf, which is what a CoA reorganisation does to an account a
   * payment already posted against — and the reversal mirrors those very accounts.
   * Unhandled, that rejects the action and the operator gets the client's generic
   * catch (a masked digest in production) in front of a ledger inconsistency.
   */
  it("reports ERROR instead of throwing when the payment's account is no longer postable", async () => {
    const poId = await seedPoWithStandingPayment("5", null);
    await prisma.chartAccount.update({ where: { id: bankAccountId }, data: { isActive: false } });

    try {
      const r = await postSupplierPaymentReversalJournalAction(poId);
      expect(r).toEqual({ ok: false, code: "ERROR" });
      expect(await reversalJournalFor(poId)).toBeNull();
    } finally {
      await prisma.chartAccount.update({ where: { id: bankAccountId }, data: { isActive: true } });
    }
  });
});
