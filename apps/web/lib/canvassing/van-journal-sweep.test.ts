import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import {
  clampVanJournalSweepFloor,
  postPendingVanJournals,
  vanJournalSweepFloor,
  VAN_AUTO_POST_SHIPPED_AT,
  VAN_JOURNAL_SWEEP_SETTLE_MS,
} from "./van-journal-sweep";
import { postVanLoadJournal } from "./van-journal";
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

async function deleteJournalFor(sourceType: string, sourceId: string): Promise<void> {
  const journal = await prisma.journal.findUnique({
    where: { sourceType_sourceId: { sourceType, sourceId: seededId(sourceId) } },
    select: { id: true },
  });
  if (journal) {
    await prisma.journalLine.deleteMany({ where: { journalId: journal.id } });
    await prisma.journal.delete({ where: { id: journal.id } });
  }
}

/* Every JOURNAL_PENDING row naming one of `docIds`, matched in JS and deleted by id. */
async function deleteNotificationsFor(docIds: string[]): Promise<void> {
  const ids = new Set(docIds.map(seededId).filter((id) => id !== ""));
  if (ids.size === 0) return;
  const rows = await prisma.adminNotification.findMany({
    where: { category: "JOURNAL_PENDING" },
    select: { id: true, metadata: true },
  });
  for (const r of rows) {
    const docId = (r.metadata as { docId?: unknown } | null)?.docId;
    if (typeof docId === "string" && ids.has(docId)) await prisma.adminNotification.delete({ where: { id: r.id } });
  }
}

/** Journal first, then the document (its lines cascade); each step guarded so one failure cannot skip the other. */
async function cleanupDoc(doc: TrackedDoc): Promise<void> {
  try {
    await deleteJournalFor(doc.sourceType, doc.id);
  } catch {
    /* best-effort */
  }
  try {
    if (doc.model === "vanLoad") await prisma.vanLoad.deleteMany({ where: { id: seededId(doc.id) } });
    else if (doc.model === "vanSale") await prisma.vanSale.deleteMany({ where: { id: seededId(doc.id) } });
    else await prisma.vanReconcile.deleteMany({ where: { id: seededId(doc.id) } });
  } catch {
    /* best-effort */
  }
}

async function journalFor(sourceType: string, sourceId: string) {
  return prisma.journal.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId } }, select: { id: true } });
}

async function pendingRowsFor(docId: string, kind: string) {
  const rows = await prisma.adminNotification.findMany({
    where: { category: "JOURNAL_PENDING" },
    select: { id: true, metadata: true },
  });
  return rows.filter((r) => {
    const m = r.metadata as { docId?: unknown; kind?: unknown } | null;
    return m?.docId === docId && m?.kind === kind;
  });
}

/* An hour ahead of real time, so freshly seeded documents are past the settle window. */
const settled = (): Date => new Date(Date.now() + 60 * 60 * 1000);

describe("clampVanJournalSweepFloor", () => {
  it("raises a derived floor below the auto-post ship time to that time", () => {
    expect(clampVanJournalSweepFloor(new Date("2026-08-01T00:00:00.000Z"))).toEqual(VAN_AUTO_POST_SHIPPED_AT);
  });

  it("keeps a derived floor at or above the auto-post ship time", () => {
    const later = new Date("2026-09-01T00:00:00.000Z");
    expect(clampVanJournalSweepFloor(later)).toEqual(later);
    expect(clampVanJournalSweepFloor(VAN_AUTO_POST_SHIPPED_AT)).toEqual(VAN_AUTO_POST_SHIPPED_AT);
  });

  it("keeps no floor as no floor", () => {
    expect(clampVanJournalSweepFloor(null)).toBeNull();
  });
});

const ROLE_TYPES: Array<[PostingRole, AccountType]> = [
  ["INVENTORY", "ASET"],
  ["INVENTORY_VAN", "ASET"],
  ["CASH", "ASET"],
  ["SALES_REVENUE", "PENDAPATAN"],
  ["COGS", "HPP"],
  ["INVENTORY_VARIANCE", "BEBAN"],
];

d("postPendingVanJournals (test bed only)", () => {
  let token = "";
  let userId = "";
  let uomId = "";
  let itemId = "";
  let anchorLoadId = "";
  let anchorCreatedAt = new Date(0);
  let mappingSnapshot: MappingSnapshot | undefined;
  const accountIds: Record<string, string> = {};
  let createdDocs: TrackedDoc[] = [];
  let docSeq = 0;

  /**
   * Seeds the shared fixture plus the floor anchor: load A with a hand-written
   * `JOURNAL_PENDING` row, so the floor is at or below A's `createdAt` whatever
   * the shared bed already holds. A is never in any sweep's scope.
   */
  beforeAll(async () => {
    token = Math.floor(Math.random() * 10_000_000).toString();
    userId = "";
    uomId = "";
    itemId = "";
    anchorLoadId = "";
    mappingSnapshot = await snapshotMappings(ROLE_TYPES.map(([role]) => role));

    const user = await prisma.user.create({
      data: { email: `test-van-sweep-${token}@test.local`, name: "Test Van Sweep User" },
    });
    userId = user.id;

    const uom = await prisma.uOM.create({ data: { code: `U-VS-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `VS-${token}`, nameId: "Test Item", nameEn: "Test Item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 1000 },
    });
    itemId = item.id;

    for (const [i, [role, type]] of ROLE_TYPES.entries()) {
      const account = await prisma.chartAccount.create({
        data: { code: `8${token}${i}`, name: `${role} (sweep test)`, type, depth: 1, isActive: true },
      });
      accountIds[role] = account.id;
      await setAccountMapping(role, account.id);
    }

    const anchor = await prisma.vanLoad.create({
      data: {
        docNo: `VANLOAD-SWEEP-${token}-A`,
        canvasserId: userId,
        loadedById: userId,
        lines: { create: [{ itemId, variantSku: null, qty: 1, unitCost: 1000 }] },
      },
      select: { id: true, createdAt: true },
    });
    anchorLoadId = anchor.id;
    anchorCreatedAt = anchor.createdAt;
    await prisma.adminNotification.create({
      data: {
        category: "JOURNAL_PENDING",
        severity: "WARNING",
        title: "Van load journal not posted",
        message: "sweep spec floor anchor",
        metadata: { docId: anchor.id, kind: "van_load", reason: "UNBALANCED", role: null },
      },
    });
  }, 60_000);

  /**
   * The mapping restore is the one step that must never fail silently: a
   * stranded mapping points real posting roles at throwaway accounts for every
   * journal the dev DB posts afterwards. It is logged and rethrown after the
   * rest of cleanup has run.
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
      await deleteNotificationsFor([anchorLoadId]);
    } catch {
      /* best-effort */
    }
    await cleanupDoc({ sourceType: "VAN_LOAD", model: "vanLoad", id: anchorLoadId });
    try {
      await prisma.chartAccount.deleteMany({ where: { id: { in: Object.values(accountIds).map(seededId) } } });
    } catch {
      /* best-effort */
    }
    try {
      await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    } catch {
      /* best-effort */
    }
    try {
      await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    } catch {
      /* best-effort */
    }
    try {
      await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    } catch {
      /* best-effort */
    }
    if (restoreFailed) {
      console.error(
        "[van-journal-sweep.test.ts] FAILED TO RESTORE JournalAccountMapping for INVENTORY, INVENTORY_VAN, CASH, " +
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

  afterEach(async () => {
    try {
      await deleteNotificationsFor(createdDocs.map((doc) => doc.id));
    } catch {
      /* best-effort */
    }
    for (const doc of createdDocs) await cleanupDoc(doc);
    createdDocs = [];
  });

  async function createLoad(unitCost: number, createdAt?: Date): Promise<{ id: string; createdAt: Date }> {
    docSeq += 1;
    const load = await prisma.vanLoad.create({
      data: {
        docNo: `VANLOAD-SWEEP-${token}-${docSeq}`,
        canvasserId: userId,
        loadedById: userId,
        ...(createdAt ? { createdAt } : {}),
        lines: { create: [{ itemId, variantSku: null, qty: 2, unitCost }] },
      },
      select: { id: true, createdAt: true },
    });
    createdDocs.push({ sourceType: "VAN_LOAD", model: "vanLoad", id: load.id });
    return load;
  }

  /* A hand-written JOURNAL_PENDING row, as a failed auto-post would have filed. */
  async function flagLoad(loadId: string): Promise<void> {
    await prisma.adminNotification.create({
      data: {
        category: "JOURNAL_PENDING",
        severity: "WARNING",
        title: "Van load journal not posted",
        message: "sweep spec flagged load",
        metadata: { docId: loadId, kind: "van_load", reason: "UNMAPPED_ROLE", role: "INVENTORY_VAN" },
      },
    });
  }

  it("derives a floor at or below the earliest flagged van document", async () => {
    const floor = await vanJournalSweepFloor();
    expect(floor).not.toBeNull();
    expect(floor?.getTime() ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(anchorCreatedAt.getTime());
  });

  it("journals an unflagged, non-zero load above the floor", async () => {
    const b = await createLoad(1000);
    const r = await postPendingVanJournals({ scope: { load: [b.id] }, now: settled() });
    expect(r).toMatchObject({ posted: 1, failed: 0, newlyFlagged: 0, skipped: null });
    expect(await journalFor("VAN_LOAD", b.id)).not.toBeNull();
    expect(await pendingRowsFor(b.id, "van_load")).toHaveLength(0);
  });

  it("never sweeps a load dated below the floor", async () => {
    const c = await createLoad(1000, new Date("2000-01-01T00:00:00.000Z"));
    const r = await postPendingVanJournals({ scope: { load: [c.id] }, now: settled() });
    expect(r.posted).toBe(0);
    expect(await journalFor("VAN_LOAD", c.id)).toBeNull();
  });

  it("does not let a zero-value load occupy the window", async () => {
    const z = await createLoad(0, new Date(anchorCreatedAt.getTime() + 1));
    const n = await createLoad(1000, new Date(anchorCreatedAt.getTime() + 2));
    const r = await postPendingVanJournals({ scope: { load: [z.id, n.id] }, limit: 1, now: settled() });
    expect(r.posted).toBe(1);
    expect(await journalFor("VAN_LOAD", n.id)).not.toBeNull();
    expect(await journalFor("VAN_LOAD", z.id)).toBeNull();
  });

  it("attempts an unflagged document even when more flagged failures than the limit precede it", async () => {
    await prisma.journalAccountMapping.deleteMany({ where: { role: "INVENTORY_VAN" } });
    try {
      const flaggedIds: string[] = [];
      for (let i = 1; i <= 3; i += 1) {
        const load = await createLoad(1000, new Date(anchorCreatedAt.getTime() + i));
        await flagLoad(load.id);
        flaggedIds.push(load.id);
      }
      const fresh = await createLoad(1000, new Date(anchorCreatedAt.getTime() + 10));

      const r = await postPendingVanJournals({ scope: { load: [...flaggedIds, fresh.id] }, limit: 2, now: settled() });
      /* The unflagged load fails and is flagged; two of the three flagged loads are retried and fail again. */
      expect(r).toMatchObject({ posted: 0, nothingToPost: 0, failed: 3, newlyFlagged: 1 });
      expect(await pendingRowsFor(fresh.id, "van_load")).toHaveLength(1);
      for (const id of flaggedIds) expect(await pendingRowsFor(id, "van_load")).toHaveLength(1);
    } finally {
      await setAccountMapping("INVENTORY_VAN", accountIds.INVENTORY_VAN);
    }
  });

  it("counts a NOTHING_TO_POST reconcile apart from posts and failures", async () => {
    docSeq += 1;
    /**
     * The documented half-cent residual: MariaDB rounds the -0.005 variance to
     * -0.01 and lets it through the prefilter, while the poster rounds it to 0.
     */
    const recon = await prisma.vanReconcile.create({
      data: {
        docNo: `VANRECON-SWEEP-${token}-${docSeq}`,
        canvasserId: userId,
        reconciledById: userId,
        totalReturnedQty: 0,
        totalVarianceQty: -0.01,
        lines: {
          create: [
            { itemId, variantSku: null, productName: "Test Item", expectedQty: 0, countedQty: 0, varianceQty: -0.01, unitCost: 0.5 },
          ],
        },
      },
      select: { id: true },
    });
    createdDocs.push({ sourceType: "VAN_RECONCILE", model: "vanReconcile", id: recon.id });

    const r = await postPendingVanJournals({ scope: { reconcile: [recon.id] }, now: settled() });
    expect(r).toMatchObject({ posted: 0, nothingToPost: 1, failed: 0, newlyFlagged: 0 });
    expect(await journalFor("VAN_RECONCILE", recon.id)).toBeNull();
    expect(await pendingRowsFor(recon.id, "van_reconcile")).toHaveLength(0);
  });

  it("flags an unflagged document once when a role is unmapped, and never again", async () => {
    await prisma.journalAccountMapping.deleteMany({ where: { role: "INVENTORY_VARIANCE" } });
    try {
      docSeq += 1;
      const recon = await prisma.vanReconcile.create({
        data: {
          docNo: `VANRECON-SWEEP-${token}-${docSeq}`,
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
      createdDocs.push({ sourceType: "VAN_RECONCILE", model: "vanReconcile", id: recon.id });

      const first = await postPendingVanJournals({ scope: { reconcile: [recon.id] }, now: settled() });
      expect(first).toMatchObject({ posted: 0, failed: 1, newlyFlagged: 1 });
      const rows = await pendingRowsFor(recon.id, "van_reconcile");
      expect(rows).toHaveLength(1);

      /* A read row is invisible to the unread dedup; the sweep must still see it. */
      await prisma.adminNotification.update({ where: { id: rows[0].id }, data: { readAt: new Date() } });

      const second = await postPendingVanJournals({ scope: { reconcile: [recon.id] }, now: settled() });
      expect(second).toMatchObject({ posted: 0, failed: 1, newlyFlagged: 0 });
      expect(await pendingRowsFor(recon.id, "van_reconcile")).toHaveLength(1);
      expect(await journalFor("VAN_RECONCILE", recon.id)).toBeNull();
    } finally {
      await setAccountMapping("INVENTORY_VARIANCE", accountIds.INVENTORY_VARIANCE);
    }
  });

  it("does not select an already-journaled document", async () => {
    const b = await createLoad(1000);
    await expect(postVanLoadJournal(b.id, userId)).resolves.toMatchObject({ ok: true, created: true });
    const r = await postPendingVanJournals({ scope: { load: [b.id] }, now: settled() });
    expect(r.posted).toBe(0);
    expect(await prisma.journal.count({ where: { sourceType: "VAN_LOAD", sourceId: b.id } })).toBe(1);
  });

  it("journals an unflagged, non-zero sale", async () => {
    docSeq += 1;
    const sale = await prisma.vanSale.create({
      data: {
        docNo: `VANSALE-SWEEP-${token}-${docSeq}`,
        salesmanId: userId,
        subtotal: 6000,
        total: 6000,
        amountPaid: 6000,
        changeAmount: 0,
        lines: {
          create: [
            { itemId, variantSku: null, productName: "Test Item", qty: 2, unitPrice: 3000, unitCost: 1000, lineTotal: 6000 },
          ],
        },
      },
      select: { id: true },
    });
    createdDocs.push({ sourceType: "VAN_SALE", model: "vanSale", id: sale.id });

    const r = await postPendingVanJournals({ scope: { sale: [sale.id] }, now: settled() });
    expect(r.posted).toBe(1);
    expect(await journalFor("VAN_SALE", sale.id)).not.toBeNull();
  });

  it("leaves a just-created document alone until it has settled", async () => {
    const b = await createLoad(1000);
    const early = await postPendingVanJournals({ scope: { load: [b.id] } });
    expect(early.posted).toBe(0);
    expect(early.failed).toBe(0);
    expect(await journalFor("VAN_LOAD", b.id)).toBeNull();
    expect(await pendingRowsFor(b.id, "van_load")).toHaveLength(0);

    const late = await postPendingVanJournals({
      scope: { load: [b.id] },
      now: new Date(Date.now() + VAN_JOURNAL_SWEEP_SETTLE_MS + 60 * 60 * 1000),
    });
    expect(late.posted).toBe(1);
    expect(await journalFor("VAN_LOAD", b.id)).not.toBeNull();
  });

  it("reads nothing for an empty scope", async () => {
    await expect(postPendingVanJournals({ scope: {} })).resolves.toEqual({
      posted: 0,
      nothingToPost: 0,
      failed: 0,
      newlyFlagged: 0,
      skipped: null,
    });
    await expect(postPendingVanJournals({ scope: { load: [], sale: [], reconcile: [] } })).resolves.toEqual({
      posted: 0,
      nothingToPost: 0,
      failed: 0,
      newlyFlagged: 0,
      skipped: null,
    });
  });
});
