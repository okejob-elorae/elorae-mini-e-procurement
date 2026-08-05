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

/** Deletes the journal (+ lines) posted for a given source, if one exists. */
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
 * Cleans up one tracked PO (its GRNs' journals, its own payment/reversal
 * journals, its GRNs, then itself). Called from a test's own `finally` (fast
 * path) AND again from the shared `afterEach` (the net) — each step is
 * individually guarded so one failure cannot block the rest, and repeating
 * the same deletes is safe (guarded lookups / `deleteMany`).
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
    await deleteJournalFor("SUPPLIER_PAYMENT", tracked.poId);
  } catch {
    /* best-effort */
  }
  try {
    await deleteJournalFor("SUPPLIER_PAYMENT_REVERSAL", tracked.poId);
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
   * failure cannot skip the rest.
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
    } catch {
      /* best-effort */
    }
    try {
      await prisma.supplier.deleteMany({ where: { id: supplierId } });
    } catch {
      /* best-effort */
    }
    try {
      await prisma.supplierType.deleteMany({ where: { id: supplierTypeId } });
    } catch {
      /* best-effort */
    }
    try {
      await prisma.user.deleteMany({ where: { id: userId } });
    } catch {
      /* best-effort */
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
    const grn = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-1`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 50_000, items: [] },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [grn.id] };
    createdPos.push(tracked);

    try {
      const posted = await postGrnJournal(grn.id, userId, prisma);
      expect(posted).toMatchObject({ ok: true, created: true });

      const paidAt = new Date("2026-02-01T00:00:00.000Z");
      const r = await postSupplierPaymentJournal(po.id, userId, paidAt, prisma);
      expect(r).toMatchObject({ ok: true, created: true });

      const journal = await prisma.journal.findUniqueOrThrow({
        where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT", sourceId: po.id } },
        include: { lines: true },
      });
      expect(amountsFor(journal.lines, accountIds.AP)).toEqual({ debit: 50_000, credit: 0 });
      expect(amountsFor(journal.lines, accountIds.BANK)).toEqual({ debit: 0, credit: 50_000 });
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
    const grnA = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-2A`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 80_000, items: [] },
      select: { id: true },
    });
    const grnB = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-2B`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 30_000, items: [] },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [grnA.id, grnB.id] };
    createdPos.push(tracked);

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
        where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT", sourceId: po.id } },
        include: { lines: true },
      });
      /* GRN B was fully reversed, so only GRN A's 80,000 remains payable. */
      expect(amountsFor(journal.lines, accountIds.AP)).toEqual({ debit: 80_000, credit: 0 });
      expect(amountsFor(journal.lines, accountIds.BANK)).toEqual({ debit: 0, credit: 80_000 });
    } finally {
      await cleanupPo(tracked);
    }
  });

  it("a PO whose GRN has no journal at all returns NOTHING_TO_POST and posts nothing", async () => {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-TEST-${token}-3`, supplierId, createdById: userId },
      select: { id: true },
    });
    const grn = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-3`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 40_000, items: [] },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [grn.id] };
    createdPos.push(tracked);

    try {
      const r = await postSupplierPaymentJournal(po.id, userId, new Date("2026-02-03T00:00:00.000Z"), prisma);
      expect(r).toEqual({ ok: false, code: "NOTHING_TO_POST" });

      const journal = await prisma.journal.findUnique({
        where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT", sourceId: po.id } },
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
    const grn = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-4`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 60_000, items: [] },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [grn.id] };
    createdPos.push(tracked);

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
        where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT_REVERSAL", sourceId: po.id } },
        include: { lines: true },
      });
      expect(amountsFor(revJournal.lines, accountIds.BANK)).toEqual({ debit: 60_000, credit: 0 });
      expect(amountsFor(revJournal.lines, accountIds.AP)).toEqual({ debit: 0, credit: 60_000 });

      const postAp = await apNetForSources(
        [
          { sourceType: "GRN", sourceId: grn.id },
          { sourceType: "SUPPLIER_PAYMENT", sourceId: po.id },
          { sourceType: "SUPPLIER_PAYMENT_REVERSAL", sourceId: po.id },
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
    const grn = await prisma.gRN.create({
      data: { docNumber: `GRN-TEST-${token}-5`, poId: po.id, supplierId, receivedBy: userId, totalAmount: 25_000, items: [] },
      select: { id: true },
    });
    const tracked: TrackedPo = { poId: po.id, grnIds: [grn.id] };
    createdPos.push(tracked);

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
});
