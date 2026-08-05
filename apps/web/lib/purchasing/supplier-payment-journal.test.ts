import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { postSupplierPaymentJournal, postSupplierPaymentReversalJournal } from "./supplier-payment-journal";
import { postGrnJournal, postGrnReversalJournal } from "../inventory/grn-journal";
import { setAccountMapping } from "../finance/journals/mapping";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../finance/journals/mapping-test-fixture";
import type { PostingRole } from "../constants/journal-roles";
import type { AccountType } from "../constants/enums";

/* Posts journals + mapping rows — never run against the shared prod DB. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

type TrackedPo = { poId: string; grnIds: string[] };

/** Deletes the journal (+ lines) posted for a given exact source, if one exists. */
async function deleteJournalFor(sourceType: string, sourceId: string): Promise<void> {
  const journal = await prisma.journal.findUnique({
    where: { sourceType_sourceId: { sourceType, sourceId } },
    select: { id: true },
  });
  if (journal) {
    await prisma.journalLine.deleteMany({ where: { journalId: journal.id } });
    await prisma.journal.delete({ where: { id: journal.id } });
  }
}

/**
 * Deletes every journal (+ lines) of a given source type whose `sourceId`
 * starts with `prefix`. Payment/reversal journals are keyed `poId#gen` (one
 * row per mark/unmark cycle), so an exact-match lookup on the bare PO id would
 * miss all of them — this sweeps every generation for one PO.
 */
async function deleteJournalsWithSourceIdPrefix(sourceType: string, prefix: string): Promise<void> {
  const journals = await prisma.journal.findMany({
    where: { sourceType, sourceId: { startsWith: prefix } },
    select: { id: true },
  });
  const ids = journals.map((j) => j.id);
  if (ids.length) {
    await prisma.journalLine.deleteMany({ where: { journalId: { in: ids } } });
    await prisma.journal.deleteMany({ where: { id: { in: ids } } });
  }
}

/**
 * Cleans up one tracked PO (its GRNs' journals, every generation of its own
 * payment/reversal journals, its GRNs, then itself). Called from a test's own
 * `finally` (fast path) AND again from the shared `afterEach` (the net) —
 * each step is individually guarded so one failure cannot block the rest, and
 * repeating the same deletes is safe (guarded lookups / `deleteMany`).
 */
async function cleanupPo(tracked: TrackedPo): Promise<void> {
  for (const grnId of tracked.grnIds) {
    try {
      await deleteJournalFor("GRN", grnId);
    } catch {
      /* best-effort */
    }
    try {
      await deleteJournalFor("GRN_REVERSAL", grnId);
    } catch {
      /* best-effort */
    }
  }
  try {
    await deleteJournalsWithSourceIdPrefix("SUPPLIER_PAYMENT", `${tracked.poId}#`);
  } catch {
    /* best-effort */
  }
  try {
    await deleteJournalsWithSourceIdPrefix("SUPPLIER_PAYMENT_REVERSAL", `${tracked.poId}#`);
  } catch {
    /* best-effort */
  }
  try {
    await prisma.gRN.deleteMany({ where: { id: { in: tracked.grnIds } } });
  } catch {
    /* best-effort */
  }
  try {
    await prisma.purchaseOrder.deleteMany({ where: { id: tracked.poId } });
  } catch {
    /* best-effort */
  }
}

/** Sums debit/credit for one chart account across every line of a journal. */
function amountsFor(lines: Array<{ chartAccountId: string; debit: unknown; credit: unknown }>, chartAccountId: string) {
  return lines
    .filter((l) => l.chartAccountId === chartAccountId)
    .reduce(
      (acc, l) => ({ debit: acc.debit + Number(l.debit), credit: acc.credit + Number(l.credit) }),
      { debit: 0, credit: 0 },
    );
}

/**
 * Net (credit − debit) posted to the AP account across a set of
 * `(sourceType, sourceId)` journal sources — scoped to the ids the caller
 * passes, never a global sweep, so this stays correct on a shared dev DB.
 */
async function apNetForSources(pairs: Array<{ sourceType: string; sourceId: string }>, apAccountId: string): Promise<number> {
  let net = 0;
  for (const { sourceType, sourceId } of pairs) {
    const journal = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType, sourceId } },
      select: { lines: { where: { chartAccountId: apAccountId }, select: { debit: true, credit: true } } },
    });
    if (!journal) continue;
    for (const l of journal.lines) net += Number(l.credit) - Number(l.debit);
  }
  return net;
}

const ROLE_TYPES: Array<[PostingRole, AccountType]> = [
  ["AP", "LIABILITAS"],
  ["BANK", "ASET"],
  ["INVENTORY", "ASET"],
];

d("supplier payment journal (test bed only)", () => {
  let token: string;
  let userId: string;
  let supplierTypeId: string;
  let supplierId: string;
  let mappingSnapshot: MappingSnapshot;
  const accountIds: Record<string, string> = {};
  let createdPos: TrackedPo[] = [];

  /*
   * Invariant fixture (3 chart accounts, 3 mappings, 1 user, 1 supplier type,
   * 1 supplier) is identical across every test in this file, so it is seeded
   * ONCE here rather than in a per-test beforeEach. PO/GRN rows differ per
   * scenario, so those stay per-test (tracked at describe scope below).
   * Explicit per-hook timeout so this does not silently depend on the
   * global vitest.config.ts ceiling.
   */
  beforeAll(async () => {
    token = Math.floor(Math.random() * 10_000_000).toString();
    mappingSnapshot = await snapshotMappings(ROLE_TYPES.map(([role]) => role));

    const user = await prisma.user.create({
      data: { email: `test-supplier-payment-${token}@test.local`, name: "Test Finance User" },
    });
    userId = user.id;

    const supplierType = await prisma.supplierType.create({ data: { code: `ST-SP-${token}`, name: "Test Type" } });
    supplierTypeId = supplierType.id;
    const supplier = await prisma.supplier.create({
      data: { code: `SUP-SP-${token}`, name: "Test Supplier", typeId: supplierTypeId },
    });
    supplierId = supplier.id;

    /* Seed one active leaf account per role, then map them. Types must satisfy
       POSTING_ROLE_ACCOUNT_TYPES or generateAutoJournal's account resolution
       will hand postJournal a non-postable account. */
    for (const [i, [role, type]] of ROLE_TYPES.entries()) {
      const account = await prisma.chartAccount.create({
        data: { code: `9${token}${i}`, name: `${role} (test)`, type, depth: 1, isActive: true },
      });
      accountIds[role] = account.id;
      await setAccountMapping(role, account.id);
    }
  }, 60_000);

  /*
   * The net: even if a beforeAll seeding step ran long and raced past some
   * other failure, this restores real GL config and removes every seeded row
   * once the whole suite is done — it does not depend on any single test's
   * teardown completing. Each delete step is individually guarded so one
   * failure cannot skip the rest, and now also logs a warning so a leaked
   * test row is at least discoverable instead of vanishing silently.
   *
   * The mapping restore is the one step that must NEVER fail silently. A
   * stranded JournalAccountMapping is worse than a failed test run: it keeps
   * pointing real posting roles at throwaway test accounts, so every journal
   * this dev DB posts afterwards — from the running local ERP UI, not just
   * other specs — silently mis-posts against the wrong accounts with no
   * error anywhere. A restore failure is loudly logged and rethrown after
   * the rest of cleanup has run.
   */
  afterAll(async () => {
    let restoreFailed: unknown;
    if (mappingSnapshot === undefined) {
      restoreFailed = new Error("mapping snapshot was never taken (beforeAll did not reach snapshotMappings)");
    } else {
      try {
        await restoreMappings(mappingSnapshot);
      } catch (e) {
        restoreFailed = e;
      }
    }
    try {
      await prisma.chartAccount.deleteMany({ where: { id: { in: Object.values(accountIds) } } });
    } catch (e) {
      console.warn("[supplier-payment-journal.test.ts] failed to delete test chart accounts", accountIds, e);
    }
    try {
      await prisma.supplier.deleteMany({ where: { id: supplierId } });
    } catch (e) {
      console.warn("[supplier-payment-journal.test.ts] failed to delete test supplier", supplierId, e);
    }
    try {
      await prisma.supplierType.deleteMany({ where: { id: supplierTypeId } });
    } catch (e) {
      console.warn("[supplier-payment-journal.test.ts] failed to delete test supplier type", supplierTypeId, e);
    }
    try {
      await prisma.user.deleteMany({ where: { id: userId } });
    } catch (e) {
      console.warn("[supplier-payment-journal.test.ts] failed to delete test user", userId, e);
    }
    if (restoreFailed) {
      console.error(
        "[supplier-payment-journal.test.ts] FAILED TO RESTORE JournalAccountMapping for AP, BANK, INVENTORY — " +
          "these roles may now point at throwaway test accounts. Check Finance → Pemetaan Akun on the :3308 dev DB " +
          "and re-map by hand if needed.",
        restoreFailed,
      );
      throw restoreFailed;
    }
  });

  beforeEach(() => {
    createdPos = [];
  });

  /* The net for per-test PO/GRN rows: repeats the same guarded cleanup
     regardless of whether the test body's own `finally` already ran it. */
  afterEach(async () => {
    for (const tracked of createdPos) {
      await cleanupPo(tracked);
    }
    createdPos = [];
  });

  it("a PO with one fully-journaled GRN posts DR AP / CR BANK at that GRN's booked amount, dated paidAt, balanced", async () => {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-TEST-${token}-1`, supplierId, createdById: userId },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [] };
    createdPos.push(tracked);
    const grn = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-1`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 50_000, items: [] },
      select: { id: true },
    });
    tracked.grnIds.push(grn.id);

    try {
      const posted = await postGrnJournal(grn.id, userId, prisma);
      expect(posted).toMatchObject({ ok: true, created: true });

      const paidAt = new Date("2026-02-01T00:00:00.000Z");
      const r = await postSupplierPaymentJournal(po.id, userId, paidAt, prisma);
      expect(r).toMatchObject({ ok: true, created: true });

      const journal = await prisma.journal.findUniqueOrThrow({
        where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT", sourceId: `${po.id}#1` } },
        include: { lines: true },
      });
      expect(journal.lines).toHaveLength(2);
      expect(amountsFor(journal.lines, accountIds.AP)).toEqual({ debit: 50_000, credit: 0 });
      expect(amountsFor(journal.lines, accountIds.BANK)).toEqual({ debit: 0, credit: 50_000 });
      /* Guards against a stray third line on an unrelated account passing unnoticed. */
      expect(amountsFor(journal.lines, accountIds.INVENTORY)).toEqual({ debit: 0, credit: 0 });
      expect(journal.date).toEqual(paidAt);

      const totalDebit = journal.lines.reduce((sum, l) => sum + Number(l.debit), 0);
      const totalCredit = journal.lines.reduce((sum, l) => sum + Number(l.credit), 0);
      expect(totalDebit).toBe(totalCredit);
    } finally {
      await cleanupPo(tracked);
    }
  });

  it("a PO with two GRNs, one of them reversed, posts the net", async () => {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-TEST-${token}-2`, supplierId, createdById: userId },
      select: { id: true },
    });
    /* Tracked immediately after the PO create — before either GRN create —
       so a throw from the second `gRN.create` still leaves the PO (and any
       GRN already created) reachable by cleanup instead of orphaned. */
    const tracked: TrackedPo = { poId: po.id, grnIds: [] };
    createdPos.push(tracked);

    const grnA = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-2A`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 80_000, items: [] },
      select: { id: true },
    });
    tracked.grnIds.push(grnA.id);
    const grnB = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-2B`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 30_000, items: [] },
      select: { id: true },
    });
    tracked.grnIds.push(grnB.id);

    try {
      const postedA = await postGrnJournal(grnA.id, userId, prisma);
      expect(postedA).toMatchObject({ ok: true, created: true });
      const postedB = await postGrnJournal(grnB.id, userId, prisma);
      expect(postedB).toMatchObject({ ok: true, created: true });
      const reversedB = await postGrnReversalJournal(grnB.id, userId, prisma);
      expect(reversedB).toMatchObject({ ok: true, created: true });

      const r = await postSupplierPaymentJournal(po.id, userId, new Date("2026-02-02T00:00:00.000Z"), prisma);
      expect(r).toMatchObject({ ok: true, created: true });

      const journal = await prisma.journal.findUniqueOrThrow({
        where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT", sourceId: `${po.id}#1` } },
        include: { lines: true },
      });
      /* GRN B was fully reversed, so only GRN A's 80,000 remains payable. */
      expect(amountsFor(journal.lines, accountIds.AP)).toEqual({ debit: 80_000, credit: 0 });
      expect(amountsFor(journal.lines, accountIds.BANK)).toEqual({ debit: 0, credit: 80_000 });
    } finally {
      await cleanupPo(tracked);
    }
  });

  it("a PO whose only GRN has no journal at all returns GRN_JOURNALS_INCOMPLETE and posts nothing", async () => {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-TEST-${token}-3`, supplierId, createdById: userId },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [] };
    createdPos.push(tracked);
    const grn = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-3`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 40_000, items: [] },
      select: { id: true },
    });
    tracked.grnIds.push(grn.id);

    try {
      /* Every receipt un-journaled is the same fault as a partially-journaled
         PO, only worse — so it gets the same precise code, not the vague
         `NOTHING_TO_POST` that reads as "nothing was ever owed". */
      const r = await postSupplierPaymentJournal(po.id, userId, new Date("2026-02-03T00:00:00.000Z"), prisma);
      expect(r).toEqual({ ok: false, code: "GRN_JOURNALS_INCOMPLETE" });

      const journal = await prisma.journal.findUnique({
        where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT", sourceId: `${po.id}#1` } },
      });
      expect(journal).toBeNull();
    } finally {
      await cleanupPo(tracked);
    }
  });

  it("a PO with two GRNs where only one is journaled returns GRN_JOURNALS_INCOMPLETE and posts nothing", async () => {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-TEST-${token}-13`, supplierId, createdById: userId },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [] };
    createdPos.push(tracked);
    const grnA = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-13A`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 60_000, items: [] },
      select: { id: true },
    });
    tracked.grnIds.push(grnA.id);
    const grnB = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-13B`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 25_000, items: [] },
      select: { id: true },
    });
    tracked.grnIds.push(grnB.id);

    try {
      /* Only GRN A journals — GRN B's auto-journal is the best-effort post that
         failed, leaving a JOURNAL_PENDING. `journals.length` is 1 and A's AP
         line is present, which is exactly how a naive check pays A's 60,000 and
         reports success while B's 25,000 waits to reappear in payables. */
      expect(await postGrnJournal(grnA.id, userId, prisma)).toMatchObject({ ok: true, created: true });

      const r = await postSupplierPaymentJournal(po.id, userId, new Date("2026-04-02T00:00:00.000Z"), prisma);
      expect(r).toEqual({ ok: false, code: "GRN_JOURNALS_INCOMPLETE" });

      const journal = await prisma.journal.findUnique({
        where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT", sourceId: `${po.id}#1` } },
      });
      expect(journal).toBeNull();
    } finally {
      await cleanupPo(tracked);
    }
  });

  it("an over-receive GRN still awaiting the owner's decision returns GRN_APPROVAL_PENDING and posts nothing", async () => {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-TEST-${token}-20`, supplierId, createdById: userId },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [] };
    createdPos.push(tracked);
    /* Exactly what `receiveGRN` leaves for an over-receive: approval required,
       neither decision stamped. */
    const grn = await prisma.gRN.create({
      data: {
        docNumber: `GRN-TEST-${token}-20`,
        poId: po.id,
        supplierId,
        receivedBy: userId,
        totalAmount: 75_000,
        items: [],
        requiresOwnerApproval: true,
      },
      select: { id: true },
    });
    tracked.grnIds.push(grn.id);

    try {
      /*
       * The receipt journal posted at receive time, so the completeness check is
       * satisfied and the AP line is present; the receipt is not declined, so the
       * reversal check is not the answer either. Paying here and letting the owner
       * decline afterwards leaves the bank cash-out standing while the decline
       * debits payables a second time — payables negative, supplier overpaid.
       */
      expect(await postGrnJournal(grn.id, userId, prisma)).toMatchObject({ ok: true, created: true });

      const r = await postSupplierPaymentJournal(po.id, userId, new Date("2026-04-13T00:00:00.000Z"), prisma);
      expect(r).toEqual({ ok: false, code: "GRN_APPROVAL_PENDING" });

      const journal = await prisma.journal.findUnique({
        where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT", sourceId: `${po.id}#1` } },
      });
      expect(journal).toBeNull();
    } finally {
      await cleanupPo(tracked);
    }
  });

  it("the same over-receive GRN once owner-APPROVED pays normally", async () => {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-TEST-${token}-21`, supplierId, createdById: userId },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [] };
    createdPos.push(tracked);
    /* Exactly what `approveGRNByOwner` leaves: the flag cleared AND the approval
       stamped. */
    const grn = await prisma.gRN.create({
      data: {
        docNumber: `GRN-TEST-${token}-21`,
        poId: po.id,
        supplierId,
        receivedBy: userId,
        totalAmount: 75_000,
        items: [],
        requiresOwnerApproval: false,
        ownerApprovedAt: new Date("2026-04-14T00:00:00.000Z"),
        ownerApprovedById: userId,
      },
      select: { id: true },
    });
    tracked.grnIds.push(grn.id);

    try {
      expect(await postGrnJournal(grn.id, userId, prisma)).toMatchObject({ ok: true, created: true });

      /* The over-blocking case: the payable is final now, so the pending guard
         must not fire and the whole 75,000 is payable. */
      const r = await postSupplierPaymentJournal(po.id, userId, new Date("2026-04-15T00:00:00.000Z"), prisma);
      expect(r).toMatchObject({ ok: true, created: true });

      const journal = await prisma.journal.findUniqueOrThrow({
        where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT", sourceId: `${po.id}#1` } },
        include: { lines: true },
      });
      expect(amountsFor(journal.lines, accountIds.AP)).toEqual({ debit: 75_000, credit: 0 });
      expect(amountsFor(journal.lines, accountIds.BANK)).toEqual({ debit: 0, credit: 75_000 });

      /*
       * `approveGRNByOwner` clears `requiresOwnerApproval` today, so keying the
       * guard on that flag alone would ALSO pass the assertions above — this pins
       * the `ownerApprovedAt` term that the mirrored decline guard actually turns
       * on. With the flag set again but the approval still stamped the receipt is
       * no longer declinable, so the guard must stay quiet: the re-run returns the
       * same journal idempotently rather than GRN_APPROVAL_PENDING (the guard runs
       * before the idempotent short-circuit, so a flag-only read fails here).
       */
      await prisma.gRN.update({ where: { id: grn.id }, data: { requiresOwnerApproval: true } });
      const rerun = await postSupplierPaymentJournal(po.id, userId, new Date("2026-04-15T00:00:00.000Z"), prisma);
      expect(rerun).toMatchObject({ ok: true, created: false });
      if (r.ok && rerun.ok) expect(rerun.journalId).toBe(r.journalId);
    } finally {
      await cleanupPo(tracked);
    }
  });

  it("the same over-receive GRN once owner-DECLINED and reversed still returns NOTHING_TO_POST, not GRN_APPROVAL_PENDING", async () => {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-TEST-${token}-22`, supplierId, createdById: userId },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [] };
    createdPos.push(tracked);
    /* Exactly what `declineGRNByOwner` leaves: the flag cleared AND the decline
       stamped. */
    const grn = await prisma.gRN.create({
      data: {
        docNumber: `GRN-TEST-${token}-22`,
        poId: po.id,
        supplierId,
        receivedBy: userId,
        totalAmount: 75_000,
        items: [],
        requiresOwnerApproval: false,
        ownerDeclinedAt: new Date("2026-04-16T00:00:00.000Z"),
      },
      select: { id: true },
    });
    tracked.grnIds.push(grn.id);

    try {
      /* The declined-and-reversed path must read exactly as it did before the
         pending guard existed — the new guard must not shadow it with a refusal
         on a decision that has already been made. */
      expect(await postGrnJournal(grn.id, userId, prisma)).toMatchObject({ ok: true, created: true });
      expect(await postGrnReversalJournal(grn.id, userId, prisma)).toMatchObject({ ok: true, created: true });

      const r = await postSupplierPaymentJournal(po.id, userId, new Date("2026-04-17T00:00:00.000Z"), prisma);
      expect(r).toEqual({ ok: false, code: "NOTHING_TO_POST" });

      const journal = await prisma.journal.findUnique({
        where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT", sourceId: `${po.id}#1` } },
      });
      expect(journal).toBeNull();
    } finally {
      await cleanupPo(tracked);
    }
  });

  it("an owner-declined GRN whose reversal journal never posted returns GRN_REVERSAL_MISSING and posts nothing", async () => {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-TEST-${token}-16`, supplierId, createdById: userId },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [] };
    createdPos.push(tracked);
    const grn = await prisma.gRN.create({
      data: {
        docNumber: `GRN-TEST-${token}-16`,
        poId: po.id,
        supplierId,
        receivedBy: userId,
        totalAmount: 55_000,
        items: [],
        ownerDeclinedAt: new Date("2026-04-05T00:00:00.000Z"),
      },
      select: { id: true },
    });
    tracked.grnIds.push(grn.id);

    try {
      /* The receipt journal posted at receive time; the decline's reversal is
         the best-effort post that failed, leaving a JOURNAL_PENDING. The
         completeness check is satisfied and the AP line is present, which is
         exactly how a naive check pays a payable the decline already cancelled. */
      expect(await postGrnJournal(grn.id, userId, prisma)).toMatchObject({ ok: true, created: true });

      const r = await postSupplierPaymentJournal(po.id, userId, new Date("2026-04-06T00:00:00.000Z"), prisma);
      expect(r).toEqual({ ok: false, code: "GRN_REVERSAL_MISSING" });

      const journal = await prisma.journal.findUnique({
        where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT", sourceId: `${po.id}#1` } },
      });
      expect(journal).toBeNull();
    } finally {
      await cleanupPo(tracked);
    }
  });

  it("an owner-declined GRN WITH its reversal journal nets to zero and returns NOTHING_TO_POST, not GRN_REVERSAL_MISSING", async () => {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-TEST-${token}-17`, supplierId, createdById: userId },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [] };
    createdPos.push(tracked);
    const grn = await prisma.gRN.create({
      data: {
        docNumber: `GRN-TEST-${token}-17`,
        poId: po.id,
        supplierId,
        receivedBy: userId,
        totalAmount: 55_000,
        items: [],
        ownerDeclinedAt: new Date("2026-04-07T00:00:00.000Z"),
      },
      select: { id: true },
    });
    tracked.grnIds.push(grn.id);

    try {
      /* Same declined receipt as the test above, this time with the reversal it
         is supposed to have — so the new check must NOT fire. Pins it as a
         refusal on a missing reversal only, never on the decline itself. */
      expect(await postGrnJournal(grn.id, userId, prisma)).toMatchObject({ ok: true, created: true });
      expect(await postGrnReversalJournal(grn.id, userId, prisma)).toMatchObject({ ok: true, created: true });

      const r = await postSupplierPaymentJournal(po.id, userId, new Date("2026-04-08T00:00:00.000Z"), prisma);
      expect(r).toEqual({ ok: false, code: "NOTHING_TO_POST" });

      const journal = await prisma.journal.findUnique({
        where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT", sourceId: `${po.id}#1` } },
      });
      expect(journal).toBeNull();
    } finally {
      await cleanupPo(tracked);
    }
  });

  it("an owner-declined GRN that never got its journal does not block a sibling receipt's payment", async () => {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-TEST-${token}-18`, supplierId, createdById: userId },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [] };
    createdPos.push(tracked);
    const grnA = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-18A`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 65_000, items: [] },
      select: { id: true },
    });
    tracked.grnIds.push(grnA.id);
    /* The receipt journal was the best-effort post that failed, and the owner
       then declined this over-receive — so it is worth well over a cent, has no
       GRN journal, and never will legitimately. */
    const grnDeclined = await prisma.gRN.create({
      data: {
        docNumber: `GRN-TEST-${token}-18B`,
        poId: po.id,
        supplierId,
        receivedBy: userId,
        totalAmount: 30_000,
        items: [],
        ownerDeclinedAt: new Date("2026-04-09T00:00:00.000Z"),
      },
      select: { id: true },
    });
    tracked.grnIds.push(grnDeclined.id);

    try {
      expect(await postGrnJournal(grnA.id, userId, prisma)).toMatchObject({ ok: true, created: true });

      /* Nothing was ever booked for the declined receipt, so it has nothing to
         contribute to the payable and must not hold the PO hostage: paying A's
         65,000 is the whole and correct payable. Without the exemption this
         reports GRN_JOURNALS_INCOMPLETE forever, and its remedy — post the
         missing GRN journal — would book a payable for goods inventory has
         already reversed. */
      const r = await postSupplierPaymentJournal(po.id, userId, new Date("2026-04-10T00:00:00.000Z"), prisma);
      expect(r).toMatchObject({ ok: true, created: true });

      const journal = await prisma.journal.findUniqueOrThrow({
        where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT", sourceId: `${po.id}#1` } },
        include: { lines: true },
      });
      expect(amountsFor(journal.lines, accountIds.AP)).toEqual({ debit: 65_000, credit: 0 });
      expect(amountsFor(journal.lines, accountIds.BANK)).toEqual({ debit: 0, credit: 65_000 });
    } finally {
      await cleanupPo(tracked);
    }
  });

  it("a PO whose only receipt is declined and never journaled returns NOTHING_TO_POST, not a blocking refusal", async () => {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-TEST-${token}-19`, supplierId, createdById: userId },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [] };
    createdPos.push(tracked);
    const grnDeclined = await prisma.gRN.create({
      data: {
        docNumber: `GRN-TEST-${token}-19`,
        poId: po.id,
        supplierId,
        receivedBy: userId,
        totalAmount: 30_000,
        items: [],
        ownerDeclinedAt: new Date("2026-04-11T00:00:00.000Z"),
      },
      select: { id: true },
    });
    tracked.grnIds.push(grnDeclined.id);

    try {
      /*
       * Walks every guard: the completeness check exempts the declined receipt,
       * `GRN_REVERSAL_MISSING` needs the receipt journal to exist and it does
       * not, so the zero-journals guard answers — nothing was ever booked, so
       * `NOTHING_TO_POST`. That is the honest code: it questions the payment
       * rather than sending the operator to post a journal for reversed goods.
       */
      const r = await postSupplierPaymentJournal(po.id, userId, new Date("2026-04-12T00:00:00.000Z"), prisma);
      expect(r).toEqual({ ok: false, code: "NOTHING_TO_POST" });

      const journal = await prisma.journal.findUnique({
        where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT", sourceId: `${po.id}#1` } },
      });
      expect(journal).toBeNull();
    } finally {
      await cleanupPo(tracked);
    }
  });

  it("a sub-cent GRN with no journal of its own does not block payment", async () => {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-TEST-${token}-14`, supplierId, createdById: userId },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [] };
    createdPos.push(tracked);
    const grnA = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-14A`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 35_000, items: [] },
      select: { id: true },
    });
    tracked.grnIds.push(grnA.id);
    /* `postGrnJournal` refuses anything under a cent, so this receipt can never
       have a journal — the completeness check must exempt it rather than block
       the PO's payment forever. */
    const grnZero = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-14B`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 0, items: [] },
      select: { id: true },
    });
    tracked.grnIds.push(grnZero.id);

    try {
      expect(await postGrnJournal(grnA.id, userId, prisma)).toMatchObject({ ok: true, created: true });
      expect(await postGrnJournal(grnZero.id, userId, prisma)).toEqual({ ok: false, code: "NOTHING_TO_POST" });

      const r = await postSupplierPaymentJournal(po.id, userId, new Date("2026-04-03T00:00:00.000Z"), prisma);
      expect(r).toMatchObject({ ok: true, created: true });

      const journal = await prisma.journal.findUniqueOrThrow({
        where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT", sourceId: `${po.id}#1` } },
        include: { lines: true },
      });
      expect(amountsFor(journal.lines, accountIds.AP)).toEqual({ debit: 35_000, credit: 0 });
      expect(amountsFor(journal.lines, accountIds.BANK)).toEqual({ debit: 0, credit: 35_000 });
    } finally {
      await cleanupPo(tracked);
    }
  });

  it("a PO whose only receipt is sub-cent returns NOTHING_TO_POST — the sole remaining route to that guard", async () => {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-TEST-${token}-15`, supplierId, createdById: userId },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [] };
    createdPos.push(tracked);
    const grnZero = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-15`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 0, items: [] },
      select: { id: true },
    });
    tracked.grnIds.push(grnZero.id);

    try {
      /*
       * The PO has a receipt and zero GRN journals, yet this is NOT
       * `GRN_JOURNALS_INCOMPLETE`: the receipt is sub-cent, so `postGrnJournal`
       * would refuse it too and nothing was ever bookable. Pins the
       * `journals.length === 0` guard as live rather than dead code — without
       * it this PO would fall through to an empty `apLines` and be reported as
       * an AP mapping fault that does not exist.
       */
      expect(await postGrnJournal(grnZero.id, userId, prisma)).toEqual({ ok: false, code: "NOTHING_TO_POST" });

      const r = await postSupplierPaymentJournal(po.id, userId, new Date("2026-04-04T00:00:00.000Z"), prisma);
      expect(r).toEqual({ ok: false, code: "NOTHING_TO_POST" });

      const journal = await prisma.journal.findUnique({
        where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT", sourceId: `${po.id}#1` } },
      });
      expect(journal).toBeNull();
    } finally {
      await cleanupPo(tracked);
    }
  });

  it("postSupplierPaymentReversalJournal posts the mirror and running it after the payment restores the AP balance", async () => {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-TEST-${token}-4`, supplierId, createdById: userId },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [] };
    createdPos.push(tracked);
    const grn = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-4`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 60_000, items: [] },
      select: { id: true },
    });
    tracked.grnIds.push(grn.id);

    try {
      const posted = await postGrnJournal(grn.id, userId, prisma);
      expect(posted).toMatchObject({ ok: true, created: true });

      const preAp = await apNetForSources([{ sourceType: "GRN", sourceId: grn.id }], accountIds.AP);
      expect(preAp).toBe(60_000);

      const payR = await postSupplierPaymentJournal(po.id, userId, new Date("2026-02-04T00:00:00.000Z"), prisma);
      expect(payR).toMatchObject({ ok: true, created: true });

      const revR = await postSupplierPaymentReversalJournal(po.id, userId, prisma);
      expect(revR).toMatchObject({ ok: true, created: true });

      const revJournal = await prisma.journal.findUniqueOrThrow({
        where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT_REVERSAL", sourceId: `${po.id}#1` } },
        include: { lines: true },
      });
      expect(amountsFor(revJournal.lines, accountIds.BANK)).toEqual({ debit: 60_000, credit: 0 });
      expect(amountsFor(revJournal.lines, accountIds.AP)).toEqual({ debit: 0, credit: 60_000 });

      const postAp = await apNetForSources(
        [
          { sourceType: "GRN", sourceId: grn.id },
          { sourceType: "SUPPLIER_PAYMENT", sourceId: `${po.id}#1` },
          { sourceType: "SUPPLIER_PAYMENT_REVERSAL", sourceId: `${po.id}#1` },
        ],
        accountIds.AP,
      );
      expect(postAp).toBe(preAp);
    } finally {
      await cleanupPo(tracked);
    }
  });

  it("calling postSupplierPaymentJournal twice is idempotent", async () => {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-TEST-${token}-5`, supplierId, createdById: userId },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [] };
    createdPos.push(tracked);
    const grn = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-5`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 25_000, items: [] },
      select: { id: true },
    });
    tracked.grnIds.push(grn.id);

    try {
      const posted = await postGrnJournal(grn.id, userId, prisma);
      expect(posted).toMatchObject({ ok: true, created: true });

      const paidAt = new Date("2026-02-05T00:00:00.000Z");
      const a = await postSupplierPaymentJournal(po.id, userId, paidAt, prisma);
      expect(a).toMatchObject({ ok: true, created: true });
      const b = await postSupplierPaymentJournal(po.id, userId, paidAt, prisma);
      expect(b).toMatchObject({ ok: true, created: false });
      if (a.ok && b.ok) expect(b.journalId).toBe(a.journalId);
    } finally {
      await cleanupPo(tracked);
    }
  });

  it("an unmapped AP role returns UNMAPPED_ROLE and posts nothing", async () => {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-TEST-${token}-6`, supplierId, createdById: userId },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [] };
    createdPos.push(tracked);
    const grn = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-6`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 10_000, items: [] },
      select: { id: true },
    });
    tracked.grnIds.push(grn.id);

    try {
      const posted = await postGrnJournal(grn.id, userId, prisma);
      expect(posted).toMatchObject({ ok: true, created: true });

      await prisma.journalAccountMapping.deleteMany({ where: { role: "AP" } });
      try {
        const r = await postSupplierPaymentJournal(po.id, userId, new Date("2026-02-06T00:00:00.000Z"), prisma);
        expect(r).toEqual({ ok: false, code: "UNMAPPED_ROLE", role: "AP" });

        const journal = await prisma.journal.findUnique({
          where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT", sourceId: `${po.id}#1` } },
        });
        expect(journal).toBeNull();
      } finally {
        /* Restore before this test's own finally runs cleanupPo, and before
           any later test in the file relies on the AP mapping being present. */
        await setAccountMapping("AP", accountIds.AP);
      }
    } finally {
      await cleanupPo(tracked);
    }
  });

  it("a remapped AP account after GRN journals were posted returns AP_ACCOUNT_MISMATCH, not a silent NOTHING_TO_POST", async () => {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-TEST-${token}-7`, supplierId, createdById: userId },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [] };
    createdPos.push(tracked);
    const grn = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-7`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 15_000, items: [] },
      select: { id: true },
    });
    tracked.grnIds.push(grn.id);

    const altAccount = await prisma.chartAccount.create({
      data: { code: `9${token}9`, name: "AP alt (test)", type: "LIABILITAS", depth: 1, isActive: true },
    });

    try {
      const posted = await postGrnJournal(grn.id, userId, prisma);
      expect(posted).toMatchObject({ ok: true, created: true });

      /* Simulates an operator repointing AP to a different account between
         receipt and payment — the exact scenario this plan exists to fix. */
      await setAccountMapping("AP", altAccount.id);
      try {
        const r = await postSupplierPaymentJournal(po.id, userId, new Date("2026-02-07T00:00:00.000Z"), prisma);
        expect(r).toEqual({ ok: false, code: "AP_ACCOUNT_MISMATCH" });

        const journal = await prisma.journal.findUnique({
          where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT", sourceId: `${po.id}#1` } },
        });
        expect(journal).toBeNull();
      } finally {
        await setAccountMapping("AP", accountIds.AP);
      }
    } finally {
      try {
        await prisma.chartAccount.deleteMany({ where: { id: altAccount.id } });
      } catch {
        /* best-effort */
      }
      await cleanupPo(tracked);
    }
  });

  it("a negative net payable (a reversal larger than the receipt) returns NOTHING_TO_POST", async () => {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-TEST-${token}-8`, supplierId, createdById: userId },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [] };
    createdPos.push(tracked);
    const grn = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-8`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 10_000, items: [] },
      select: { id: true },
    });
    tracked.grnIds.push(grn.id);

    try {
      const posted = await postGrnJournal(grn.id, userId, prisma);
      expect(posted).toMatchObject({ ok: true, created: true });

      /* The reversal reads the GRN's CURRENT totalAmount, not the amount
         already journaled — bumping it before reversing debits AP for more
         than the original receipt credited it, driving the net negative. */
      await prisma.gRN.update({ where: { id: grn.id }, data: { totalAmount: 90_000 } });
      const reversed = await postGrnReversalJournal(grn.id, userId, prisma);
      expect(reversed).toMatchObject({ ok: true, created: true });

      const r = await postSupplierPaymentJournal(po.id, userId, new Date("2026-02-08T00:00:00.000Z"), prisma);
      expect(r).toEqual({ ok: false, code: "NOTHING_TO_POST" });
    } finally {
      await cleanupPo(tracked);
    }
  });

  it("mark -> unmark -> re-mark produces two payment journals and one reversal, netting AP back to its pre-payment balance", async () => {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-TEST-${token}-9`, supplierId, createdById: userId },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [] };
    createdPos.push(tracked);
    const grn = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-9`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 45_000, items: [] },
      select: { id: true },
    });
    tracked.grnIds.push(grn.id);

    try {
      const posted = await postGrnJournal(grn.id, userId, prisma);
      expect(posted).toMatchObject({ ok: true, created: true });

      const mark1 = await postSupplierPaymentJournal(po.id, userId, new Date("2026-03-01T00:00:00.000Z"), prisma);
      expect(mark1).toMatchObject({ ok: true, created: true });

      const unmark1 = await postSupplierPaymentReversalJournal(po.id, userId, prisma);
      expect(unmark1).toMatchObject({ ok: true, created: true });

      const mark2 = await postSupplierPaymentJournal(po.id, userId, new Date("2026-03-02T00:00:00.000Z"), prisma);
      expect(mark2).toMatchObject({ ok: true, created: true });
      if (mark1.ok && mark2.ok) expect(mark2.journalId).not.toBe(mark1.journalId);

      const gen1 = await prisma.journal.findUniqueOrThrow({
        where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT", sourceId: `${po.id}#1` } },
        include: { lines: true },
      });
      const gen2 = await prisma.journal.findUniqueOrThrow({
        where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT", sourceId: `${po.id}#2` } },
        include: { lines: true },
      });
      const reversal = await prisma.journal.findUniqueOrThrow({
        where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT_REVERSAL", sourceId: `${po.id}#1` } },
        include: { lines: true },
      });

      expect(amountsFor(gen1.lines, accountIds.AP)).toEqual({ debit: 45_000, credit: 0 });
      expect(amountsFor(gen2.lines, accountIds.AP)).toEqual({ debit: 45_000, credit: 0 });
      expect(amountsFor(reversal.lines, accountIds.AP)).toEqual({ debit: 0, credit: 45_000 });

      for (const j of [gen1, gen2, reversal]) {
        const totalDebit = j.lines.reduce((sum, l) => sum + Number(l.debit), 0);
        const totalCredit = j.lines.reduce((sum, l) => sum + Number(l.credit), 0);
        expect(totalDebit).toBe(totalCredit);
      }

      /* GRN credited 45,000; gen-1 payment debited it to 0; the reversal
         credited it back to 45,000; gen-2 payment debited it to 0 again —
         i.e. paid, unmarked, and re-paid nets AP to zero. */
      const apNet = await apNetForSources(
        [
          { sourceType: "GRN", sourceId: grn.id },
          { sourceType: "SUPPLIER_PAYMENT", sourceId: `${po.id}#1` },
          { sourceType: "SUPPLIER_PAYMENT_REVERSAL", sourceId: `${po.id}#1` },
          { sourceType: "SUPPLIER_PAYMENT", sourceId: `${po.id}#2` },
        ],
        accountIds.AP,
      );
      expect(apNet).toBe(0);
    } finally {
      await cleanupPo(tracked);
    }
  });

  it("a retry of the first mark (double-submit, no intervening unmark) still produces exactly one payment journal", async () => {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-TEST-${token}-10`, supplierId, createdById: userId },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [] };
    createdPos.push(tracked);
    const grn = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-10`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 20_000, items: [] },
      select: { id: true },
    });
    tracked.grnIds.push(grn.id);

    try {
      const posted = await postGrnJournal(grn.id, userId, prisma);
      expect(posted).toMatchObject({ ok: true, created: true });

      const paidAt = new Date("2026-03-03T00:00:00.000Z");
      const a = await postSupplierPaymentJournal(po.id, userId, paidAt, prisma);
      expect(a).toMatchObject({ ok: true, created: true });
      const retry = await postSupplierPaymentJournal(po.id, userId, paidAt, prisma);
      expect(retry).toMatchObject({ ok: true, created: false });
      if (a.ok && retry.ok) expect(retry.journalId).toBe(a.journalId);

      const journals = await prisma.journal.findMany({
        where: { sourceType: "SUPPLIER_PAYMENT", sourceId: { startsWith: `${po.id}#` } },
      });
      expect(journals).toHaveLength(1);
    } finally {
      await cleanupPo(tracked);
    }
  });

  it("a PO whose receipts straddle an AP remap returns AP_ACCOUNT_MISMATCH instead of under-paying", async () => {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-TEST-${token}-11`, supplierId, createdById: userId },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [] };
    createdPos.push(tracked);
    const grnA = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-11A`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 70_000, items: [] },
      select: { id: true },
    });
    tracked.grnIds.push(grnA.id);
    const grnB = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-11B`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 30_000, items: [] },
      select: { id: true },
    });
    tracked.grnIds.push(grnB.id);

    const altAccount = await prisma.chartAccount.create({
      data: { code: `9${token}7`, name: "AP alt split (test)", type: "LIABILITAS", depth: 1, isActive: true },
    });

    try {
      /* GRN A books its payable to the original AP account... */
      expect(await postGrnJournal(grnA.id, userId, prisma)).toMatchObject({ ok: true, created: true });

      /* ...then AP is repointed, so GRN B books its payable somewhere else.
         `apLines` is non-empty (B contributed), which is exactly how a naive
         check would miss that A's 70,000 is unreachable and pay only 30,000. */
      await setAccountMapping("AP", altAccount.id);
      try {
        expect(await postGrnJournal(grnB.id, userId, prisma)).toMatchObject({ ok: true, created: true });

        const r = await postSupplierPaymentJournal(po.id, userId, new Date("2026-04-01T00:00:00.000Z"), prisma);
        expect(r).toEqual({ ok: false, code: "AP_ACCOUNT_MISMATCH" });

        const journal = await prisma.journal.findUnique({
          where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT", sourceId: `${po.id}#1` } },
        });
        expect(journal).toBeNull();
      } finally {
        await setAccountMapping("AP", accountIds.AP);
      }
    } finally {
      /* Journal lines reference the alt account, so they go first. */
      await cleanupPo(tracked);
      try {
        await prisma.chartAccount.deleteMany({ where: { id: altAccount.id } });
      } catch {
        /* best-effort */
      }
    }
  });

  it("the reversal mirrors the payment's own accounts and date, not whatever the roles resolve to at unmark time", async () => {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-TEST-${token}-12`, supplierId, createdById: userId },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [] };
    createdPos.push(tracked);
    const grn = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-12`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 55_000, items: [] },
      select: { id: true },
    });
    tracked.grnIds.push(grn.id);

    const altAccount = await prisma.chartAccount.create({
      data: { code: `9${token}6`, name: "AP alt reversal (test)", type: "LIABILITAS", depth: 1, isActive: true },
    });

    try {
      expect(await postGrnJournal(grn.id, userId, prisma)).toMatchObject({ ok: true, created: true });

      const paidAt = new Date("2026-08-31T00:00:00.000Z");
      expect(await postSupplierPaymentJournal(po.id, userId, paidAt, prisma)).toMatchObject({ ok: true, created: true });

      /* AP is repointed while the PO sits marked paid. A role-resolving reversal
         would credit the NEW account and strand the payment's debit on the old
         one; mirroring credits the account the payment actually debited. */
      await setAccountMapping("AP", altAccount.id);
      try {
        expect(await postSupplierPaymentReversalJournal(po.id, userId, prisma)).toMatchObject({ ok: true, created: true });
      } finally {
        await setAccountMapping("AP", accountIds.AP);
      }

      const reversal = await prisma.journal.findUniqueOrThrow({
        where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT_REVERSAL", sourceId: `${po.id}#1` } },
        include: { lines: true },
      });
      expect(reversal.lines).toHaveLength(2);
      expect(amountsFor(reversal.lines, accountIds.AP)).toEqual({ debit: 0, credit: 55_000 });
      expect(amountsFor(reversal.lines, accountIds.BANK)).toEqual({ debit: 55_000, credit: 0 });
      expect(amountsFor(reversal.lines, altAccount.id)).toEqual({ debit: 0, credit: 0 });
      /* Dated to the payment, so the reversal cannot land in a later period. */
      expect(reversal.date).toEqual(paidAt);

      /* Payment plus reversal net AP back to the payable the GRN booked. */
      const apNet = await apNetForSources(
        [
          { sourceType: "GRN", sourceId: grn.id },
          { sourceType: "SUPPLIER_PAYMENT", sourceId: `${po.id}#1` },
          { sourceType: "SUPPLIER_PAYMENT_REVERSAL", sourceId: `${po.id}#1` },
        ],
        accountIds.AP,
      );
      expect(apNet).toBe(55_000);
    } finally {
      await cleanupPo(tracked);
      try {
        await prisma.chartAccount.deleteMany({ where: { id: altAccount.id } });
      } catch {
        /* best-effort */
      }
    }
  });
});
