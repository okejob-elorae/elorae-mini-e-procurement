import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

  beforeEach(async () => {
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

    /* Seed a throwaway user + one active leaf account per role, then map them.
       Types must satisfy POSTING_ROLE_ACCOUNT_TYPES or generateAutoJournal's
       account resolution will hand postJournal a non-postable account. */
    for (const [i, [role, type]] of ROLE_TYPES.entries()) {
      const account = await prisma.chartAccount.create({
        data: { code: `9${token}${i}`, name: `${role} (test)`, type, depth: 1, isActive: true },
      });
      accountIds[role] = account.id;
      await setAccountMapping(role, account.id);
    }
  });

  afterEach(async () => {
    /* Delete in child-before-parent order, each step individually guarded so one
       failure cannot skip the rest: journal lines, journals, van docs, accounts,
       user, then restoreMappings(mappingSnapshot). */
    try {
      await restoreMappings(mappingSnapshot);
    } catch {
      /* best-effort — do not let a snapshot-restore failure skip the rest of teardown */
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
  });

  it("postVanLoadJournal posts a balanced DR INVENTORY_VAN / CR INVENTORY at Σ qty × unitCost, idempotent on repost", async () => {
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
      select: { id: true },
    });

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

      const b = await postVanLoadJournal(load.id, userId, prisma);
      expect(b).toMatchObject({ ok: true, created: false });
      if (a.ok && b.ok) expect(b.journalId).toBe(a.journalId);
    } finally {
      await deleteJournalFor("VAN_LOAD", load.id);
      await prisma.vanLoad.delete({ where: { id: load.id } });
    }
  });

  it("postVanSaleJournal posts four lines — DR CASH / CR SALES_REVENUE at total, DR COGS / CR INVENTORY_VAN at Σ qty × unitCost", async () => {
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
      select: { id: true },
    });

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

      const totalDebit = journal.lines.reduce((sum, l) => sum + Number(l.debit), 0);
      const totalCredit = journal.lines.reduce((sum, l) => sum + Number(l.credit), 0);
      expect(totalDebit).toBe(totalCredit);
    } finally {
      await deleteJournalFor("VAN_SALE", sale.id);
      await prisma.vanSale.delete({ where: { id: sale.id } });
    }
  });

  it("postVanReconcileJournal with nonzero variance posts DR INVENTORY/CR INVENTORY_VAN for returned AND DR INVENTORY_VARIANCE/CR INVENTORY_VAN for the shortfall", async () => {
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
      select: { id: true },
    });

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
    } finally {
      await deleteJournalFor("VAN_RECONCILE", recon.id);
      await prisma.vanReconcile.delete({ where: { id: recon.id } });
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
      select: { id: true },
    });

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
      await deleteJournalFor("VAN_RECONCILE", recon.id);
      await prisma.vanReconcile.delete({ where: { id: recon.id } });
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

    try {
      const r = await postVanLoadJournal(load.id, userId, prisma);
      expect(r).toEqual({ ok: false, code: "NOTHING_TO_POST" });

      const journal = await prisma.journal.findUnique({
        where: { sourceType_sourceId: { sourceType: "VAN_LOAD", sourceId: load.id } },
      });
      expect(journal).toBeNull();
    } finally {
      await deleteJournalFor("VAN_LOAD", load.id);
      await prisma.vanLoad.delete({ where: { id: load.id } });
    }
  });
});
