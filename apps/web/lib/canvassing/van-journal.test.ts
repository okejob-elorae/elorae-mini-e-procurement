import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { postVanLoadJournal, postVanSaleJournal, postVanReconcileJournal } from "./van-journal";
import { setAccountMapping } from "../finance/journals/mapping";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../finance/journals/mapping-test-fixture";
import type { PostingRole } from "../constants/journal-roles";
import type { AccountType } from "../constants/enums";

/* Posts journals + mapping rows — never run against the shared prod DB. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

type DocModel = "vanLoad" | "vanSale" | "vanReconcile";
type TrackedDoc = { sourceType: string; model: DocModel; id: string };

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
 * Cleans up one tracked van document (journal first, then the doc itself — its
 * lines cascade). Called from a test's own `finally` (fast path) AND again from
 * the shared `afterEach` (the net) — idempotent via `deleteMany`/guarded lookup,
 * and each of the two steps is individually guarded so a failure in one cannot
 * block the other.
 */
async function cleanupDoc(doc: TrackedDoc): Promise<void> {
  try {
    await deleteJournalFor(doc.sourceType, doc.id);
  } catch {
    /* best-effort */
  }
  try {
    if (doc.model === "vanLoad") await prisma.vanLoad.deleteMany({ where: { id: doc.id } });
    else if (doc.model === "vanSale") await prisma.vanSale.deleteMany({ where: { id: doc.id } });
    else await prisma.vanReconcile.deleteMany({ where: { id: doc.id } });
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

const ROLE_TYPES: Array<[PostingRole, AccountType]> = [
  ["INVENTORY", "ASET"],
  ["INVENTORY_VAN", "ASET"],
  ["CASH", "ASET"],
  ["SALES_REVENUE", "PENDAPATAN"],
  ["COGS", "HPP"],
  ["INVENTORY_VARIANCE", "BEBAN"],
];

d("van journals (test bed only)", () => {
  let token: string;
  let userId: string;
  let uomId: string;
  let itemId: string;
  let mappingSnapshot: MappingSnapshot;
  const accountIds: Record<string, string> = {};
  let createdDocs: TrackedDoc[] = [];

  /*
   * Invariant fixture (6 chart accounts, 6 mappings, 1 user, 1 uom, 1 item) is
   * identical across every test in this file, so it is seeded ONCE here rather
   * than in a per-test beforeEach — collapsing 5 separate windows of mutating
   * shared GL config down to 1. Explicit per-hook timeout so this does not
   * silently depend on the global vitest.config.ts ceiling.
   */
  beforeAll(async () => {
    token = Math.floor(Math.random() * 10_000_000).toString();
    mappingSnapshot = await snapshotMappings(ROLE_TYPES.map(([role]) => role));

    const user = await prisma.user.create({
      data: { email: `test-van-journal-${token}@test.local`, name: "Test Van User" },
    });
    userId = user.id;

    const uom = await prisma.uOM.create({ data: { code: `U-VJ-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `VJ-${token}`, nameId: "Test Item", nameEn: "Test Item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 1000 },
    });
    itemId = item.id;

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
   * error anywhere. If `beforeAll` itself times out, the vitest runner marks
   * every test skipped and calls `afterAll` almost immediately while the
   * timed-out hook keeps running as a zombie in the background; in that
   * case `mappingSnapshot` may still be `undefined` here. That residual
   * cannot be fully closed from inside this fixture (a zombie hook writing
   * after `afterAll` has already returned is beyond any afterAll's reach —
   * the real fix is DB-spec isolation, tracked as a follow-up in
   * docs/FOLLOWUPS.md) — but it must not pass quietly, so a restore failure is
   * loudly logged and rethrown after the rest of cleanup has run.
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
      await prisma.item.deleteMany({ where: { id: itemId } });
    } catch {
      /* best-effort */
    }
    try {
      await prisma.uOM.deleteMany({ where: { id: uomId } });
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
        "[van-journal.test.ts] FAILED TO RESTORE JournalAccountMapping for INVENTORY, INVENTORY_VAN, CASH, " +
          "SALES_REVENUE, COGS, INVENTORY_VARIANCE — these roles may now point at throwaway test accounts. " +
          "Check Finance → Pemetaan Akun on the :3308 dev DB and re-map by hand if needed.",
        restoreFailed,
      );
      throw restoreFailed;
    }
  });

  beforeEach(() => {
    createdDocs = [];
  });

  /* The net for per-test docs: repeats the same guarded cleanup regardless of
     whether the test body's own `finally` already ran it (idempotent). */
  afterEach(async () => {
    for (const doc of createdDocs) {
      await cleanupDoc(doc);
    }
    createdDocs = [];
  });

  it("postVanLoadJournal posts a balanced DR INVENTORY_VAN / CR INVENTORY at Σ qty × unitCost, dated the load's own createdAt, idempotent on repost", async () => {
    const load = await prisma.vanLoad.create({
      data: {
        docNo: `VANLOAD-TEST-${token}`,
        canvasserId: userId,
        loadedById: userId,
        lines: {
          create: [
            { itemId, variantSku: null, qty: 3, unitCost: 1000 },
            { itemId, variantSku: null, qty: 2, unitCost: 2500 },
          ],
        },
      },
      select: { id: true, createdAt: true },
    });
    createdDocs.push({ sourceType: "VAN_LOAD", model: "vanLoad", id: load.id });

    try {
      const a = await postVanLoadJournal(load.id, userId, prisma);
      expect(a).toMatchObject({ ok: true, created: true });

      const journal = await prisma.journal.findUniqueOrThrow({
        where: { sourceType_sourceId: { sourceType: "VAN_LOAD", sourceId: load.id } },
        include: { lines: true },
      });
      expect(journal.lines).toHaveLength(2);
      expect(amountsFor(journal.lines, accountIds.INVENTORY_VAN)).toEqual({ debit: 8000, credit: 0 });
      expect(amountsFor(journal.lines, accountIds.INVENTORY)).toEqual({ debit: 0, credit: 8000 });
      expect(journal.date).toEqual(load.createdAt);

      const b = await postVanLoadJournal(load.id, userId, prisma);
      expect(b).toMatchObject({ ok: true, created: false });
      if (a.ok && b.ok) expect(b.journalId).toBe(a.journalId);
    } finally {
      await cleanupDoc({ sourceType: "VAN_LOAD", model: "vanLoad", id: load.id });
    }
  });

  it("postVanSaleJournal posts four lines — DR CASH / CR SALES_REVENUE at total, DR COGS / CR INVENTORY_VAN at Σ qty × unitCost, dated the sale's own createdAt", async () => {
    const sale = await prisma.vanSale.create({
      data: {
        docNo: `VANSALE-TEST-${token}`,
        salesmanId: userId,
        subtotal: 15_000,
        total: 15_000,
        amountPaid: 15_000,
        changeAmount: 0,
        lines: {
          create: [
            { itemId, variantSku: null, productName: "Test Item", qty: 3, unitPrice: 3000, unitCost: 1000, lineTotal: 9000 },
            { itemId, variantSku: null, productName: "Test Item", qty: 2, unitPrice: 3000, unitCost: 2000, lineTotal: 6000 },
          ],
        },
      },
      select: { id: true, createdAt: true },
    });
    createdDocs.push({ sourceType: "VAN_SALE", model: "vanSale", id: sale.id });

    try {
      const r = await postVanSaleJournal(sale.id, userId, prisma);
      expect(r).toMatchObject({ ok: true, created: true });

      const journal = await prisma.journal.findUniqueOrThrow({
        where: { sourceType_sourceId: { sourceType: "VAN_SALE", sourceId: sale.id } },
        include: { lines: true },
      });
      expect(journal.lines).toHaveLength(4);
      expect(amountsFor(journal.lines, accountIds.CASH)).toEqual({ debit: 15_000, credit: 0 });
      expect(amountsFor(journal.lines, accountIds.SALES_REVENUE)).toEqual({ debit: 0, credit: 15_000 });
      expect(amountsFor(journal.lines, accountIds.COGS)).toEqual({ debit: 7000, credit: 0 });
      expect(amountsFor(journal.lines, accountIds.INVENTORY_VAN)).toEqual({ debit: 0, credit: 7000 });
      expect(journal.date).toEqual(sale.createdAt);

      const totalDebit = journal.lines.reduce((sum, l) => sum + Number(l.debit), 0);
      const totalCredit = journal.lines.reduce((sum, l) => sum + Number(l.credit), 0);
      expect(totalDebit).toBe(totalCredit);
    } finally {
      await cleanupDoc({ sourceType: "VAN_SALE", model: "vanSale", id: sale.id });
    }
  });

  it("postVanReconcileJournal with nonzero variance posts DR INVENTORY/CR INVENTORY_VAN for returned AND DR INVENTORY_VARIANCE/CR INVENTORY_VAN for the shortfall, dated the reconcile's own createdAt", async () => {
    const recon = await prisma.vanReconcile.create({
      data: {
        docNo: `VANRECON-TEST-${token}-A`,
        canvasserId: userId,
        reconciledById: userId,
        totalReturnedQty: 7,
        totalVarianceQty: 3,
        lines: {
          create: [
            { itemId, variantSku: null, productName: "Test Item", expectedQty: 10, countedQty: 7, varianceQty: 3, unitCost: 1000 },
          ],
        },
      },
      select: { id: true, createdAt: true },
    });
    createdDocs.push({ sourceType: "VAN_RECONCILE", model: "vanReconcile", id: recon.id });

    try {
      const r = await postVanReconcileJournal(recon.id, userId, prisma);
      expect(r).toMatchObject({ ok: true, created: true });

      const journal = await prisma.journal.findUniqueOrThrow({
        where: { sourceType_sourceId: { sourceType: "VAN_RECONCILE", sourceId: recon.id } },
        include: { lines: true },
      });
      expect(journal.lines).toHaveLength(4);
      expect(amountsFor(journal.lines, accountIds.INVENTORY)).toEqual({ debit: 7000, credit: 0 });
      expect(amountsFor(journal.lines, accountIds.INVENTORY_VARIANCE)).toEqual({ debit: 3000, credit: 0 });
      /* INVENTORY_VAN is credited twice — once for the returned leg, once for the variance leg. */
      expect(amountsFor(journal.lines, accountIds.INVENTORY_VAN)).toEqual({ debit: 0, credit: 10_000 });
      expect(journal.date).toEqual(recon.createdAt);
    } finally {
      await cleanupDoc({ sourceType: "VAN_RECONCILE", model: "vanReconcile", id: recon.id });
    }
  });

  it("postVanReconcileJournal with zero variance posts only the returned pair (no variance line)", async () => {
    const recon = await prisma.vanReconcile.create({
      data: {
        docNo: `VANRECON-TEST-${token}-B`,
        canvasserId: userId,
        reconciledById: userId,
        totalReturnedQty: 10,
        totalVarianceQty: 0,
        lines: {
          create: [
            { itemId, variantSku: null, productName: "Test Item", expectedQty: 10, countedQty: 10, varianceQty: 0, unitCost: 500 },
          ],
        },
      },
      select: { id: true, createdAt: true },
    });
    createdDocs.push({ sourceType: "VAN_RECONCILE", model: "vanReconcile", id: recon.id });

    try {
      const r = await postVanReconcileJournal(recon.id, userId, prisma);
      expect(r).toMatchObject({ ok: true, created: true });

      const journal = await prisma.journal.findUniqueOrThrow({
        where: { sourceType_sourceId: { sourceType: "VAN_RECONCILE", sourceId: recon.id } },
        include: { lines: true },
      });
      expect(journal.lines).toHaveLength(2);
      expect(amountsFor(journal.lines, accountIds.INVENTORY)).toEqual({ debit: 5000, credit: 0 });
      expect(amountsFor(journal.lines, accountIds.INVENTORY_VAN)).toEqual({ debit: 0, credit: 5000 });
      expect(amountsFor(journal.lines, accountIds.INVENTORY_VARIANCE)).toEqual({ debit: 0, credit: 0 });
    } finally {
      await cleanupDoc({ sourceType: "VAN_RECONCILE", model: "vanReconcile", id: recon.id });
    }
  });

  it("postVanReconcileJournal with negative variance (counted more than expected) reverses the write-off direction, with no negative line amounts", async () => {
    const recon = await prisma.vanReconcile.create({
      data: {
        docNo: `VANRECON-TEST-${token}-C`,
        canvasserId: userId,
        reconciledById: userId,
        totalReturnedQty: 12,
        totalVarianceQty: -2,
        lines: {
          create: [
            { itemId, variantSku: null, productName: "Test Item", expectedQty: 10, countedQty: 12, varianceQty: -2, unitCost: 1000 },
          ],
        },
      },
      select: { id: true, createdAt: true },
    });
    createdDocs.push({ sourceType: "VAN_RECONCILE", model: "vanReconcile", id: recon.id });

    try {
      const r = await postVanReconcileJournal(recon.id, userId, prisma);
      expect(r).toMatchObject({ ok: true, created: true });

      const journal = await prisma.journal.findUniqueOrThrow({
        where: { sourceType_sourceId: { sourceType: "VAN_RECONCILE", sourceId: recon.id } },
        include: { lines: true },
      });
      expect(journal.lines).toHaveLength(4);
      expect(amountsFor(journal.lines, accountIds.INVENTORY)).toEqual({ debit: 12_000, credit: 0 });
      /* INVENTORY_VAN nets a debit (surplus reversal) and a credit (returned leg) on separate lines. */
      expect(amountsFor(journal.lines, accountIds.INVENTORY_VAN)).toEqual({ debit: 2000, credit: 12_000 });
      expect(amountsFor(journal.lines, accountIds.INVENTORY_VARIANCE)).toEqual({ debit: 0, credit: 2000 });

      for (const line of journal.lines) {
        expect(Number(line.debit)).toBeGreaterThanOrEqual(0);
        expect(Number(line.credit)).toBeGreaterThanOrEqual(0);
      }
      const totalDebit = journal.lines.reduce((sum, l) => sum + Number(l.debit), 0);
      const totalCredit = journal.lines.reduce((sum, l) => sum + Number(l.credit), 0);
      expect(totalDebit).toBe(totalCredit);
    } finally {
      await cleanupDoc({ sourceType: "VAN_RECONCILE", model: "vanReconcile", id: recon.id });
    }
  });

  it("a van load whose lines total zero returns NOTHING_TO_POST and posts nothing", async () => {
    const load = await prisma.vanLoad.create({
      data: {
        docNo: `VANLOAD-TEST-${token}-ZERO`,
        canvasserId: userId,
        loadedById: userId,
        lines: {
          create: [{ itemId, variantSku: null, qty: 5, unitCost: 0 }],
        },
      },
      select: { id: true },
    });
    createdDocs.push({ sourceType: "VAN_LOAD", model: "vanLoad", id: load.id });

    try {
      const r = await postVanLoadJournal(load.id, userId, prisma);
      expect(r).toEqual({ ok: false, code: "NOTHING_TO_POST" });

      const journal = await prisma.journal.findUnique({
        where: { sourceType_sourceId: { sourceType: "VAN_LOAD", sourceId: load.id } },
      });
      expect(journal).toBeNull();
    } finally {
      await cleanupDoc({ sourceType: "VAN_LOAD", model: "vanLoad", id: load.id });
    }
  });
});
