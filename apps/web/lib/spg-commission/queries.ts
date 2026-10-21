import { prisma, type Prisma } from "@elorae/db";
import { loadSellThroughInputs } from "@/lib/konsi-sell-through/window";
import { getJakartaMonthBounds } from "@/lib/planning/calculations";
import type { LedgerRow } from "@/lib/konsi-sell-through/derive";
import {
  computeCommissionEvents,
  summariseRecap,
  type CommissionEvent,
  type CommissionReport,
  type RecapDetailRow,
  type RecapRow,
  type SpgPosQty,
} from "./compute";
import { SpgCommissionRateError } from "./errors";
import { isYearMonth } from "./month";
import { listRates } from "./rates";
import { perSpgPosQtyForLines, spgSaleIdsOf, type SplitLine } from "./split-weights";

type Client = Prisma.TransactionClient | typeof prisma;

export type CommissionRecap = {
  yearMonth: string;
  rows: RecapRow[];
  detail: RecapDetailRow[];
  noRate: Array<{ categoryId: string | null; categoryName: string | null; pieces: number }>;
  /* The month's events, one per report × SPG × category × kind, for a per-report export. */
  events: CommissionEvent[];
  /* Each loaded report's `docNo` by id, so every event's `sellThroughId` can be printed as the report number. */
  reportDocNos: Record<string, string>;
  spgNames: Record<string, string>;
  storeNames: Record<string, string>;
  categoryNames: Record<string, string>;
};

type ChainLink = { id: string; closingStocktakeId: string; previousId: string | null };

type StoredLine = { itemId: string; variantSku: string; posSoldQty: Prisma.Decimal; latePosSoldQty: Prisma.Decimal };

const lineKey = (itemId: string, variantSku: string) => `${itemId}::${variantSku}`;

const splitLine = (l: StoredLine): SplitLine => ({
  itemId: l.itemId,
  variantSku: l.variantSku,
  posSoldQty: l.posSoldQty.toNumber(),
  latePosSoldQty: l.latePosSoldQty.toNumber(),
});

/**
 * The ledger rows of one report's window, read only to derive the split of a report approved before
 * the split was snapshotted. Through the same `loadSellThroughInputs` the report writer derives
 * from, so the window — lower edge exclusive, store-scoped, boundary at the closing stocktake's own
 * rows — is never re-spelled here.
 */
async function windowRows(
  client: Client,
  storeId: string,
  report: ChainLink,
  previous: { id: string; closingStocktakeId: string } | null,
): Promise<LedgerRow[]> {
  /* The base client carries every TransactionClient member; the helper is typed for a tx only because its writers call it inside one. */
  const inputs = await loadSellThroughInputs(client as Prisma.TransactionClient, {
    storeId,
    closingStocktakeId: report.closingStocktakeId,
    previous,
  });
  return inputs.rows;
}

/**
 * The SPG commission recap for one WIB month (see `compute.ts` for the rules).
 *
 * Loads every non-DRAFT, non-CANCELLED report with an event in the month: APPROVED or VOIDED with
 * `approvedAt` in it, or VOIDED with `voidedAt` in it. A report voided this month but approved
 * earlier is loaded for its reversal, which mirrors the earlier EARNED event from the same split
 * weights; only the month's events are summarised.
 *
 * The pieces a line confirms come from the line's STORED figures (`posSoldQty`, which already
 * includes `latePosSoldQty`, and `billedQty`), never from the live ledger. The split between SPGs
 * is weighted by each SPG's POS units on the line, and where those weights come from depends on
 * when the report was approved:
 *
 * - A report with `spgSplitSnapshotAt` set reads them from its `KonsiSellThroughSpgShare` rows,
 *   OWN and LATE together, written by approve in its own transaction (`writeSpgSplitSnapshot`,
 *   `lib/konsi-sell-through/writer.ts`). No ledger row that commits later can move them, so a closed
 *   month's split is fixed. A snapshotted report with no rows sold nothing through POS.
 * - A report approved before the snapshot existed (`spgSplitSnapshotAt` null) is derived live, as
 *   it always was, by the same rule approve now stores (`perSpgPosQtyForLines`, `split-weights.ts`):
 *   its own share is the first `posSoldQty − latePosSoldQty` units of the SpgSale rows in its window,
 *   re-read through `loadSellThroughInputs` in ledger order (`createdAt`, then id), and its late share
 *   the next `latePosSoldQty` units after the previous report's own share in the previous window —
 *   or, should that previous report carry a snapshot, the previous window's units beyond it.
 *   That live read keeps the old race for these reports only: a row's `createdAt` is fixed when its
 *   insert runs, not when it commits, so a row inserted before a counted one but committed after
 *   approval sorts among the counted rows and, on the next read, displaces one of them into the late
 *   share — the report's split between SPGs shifts in an already-closed month, its total does not.
 *   A sale row whose SpgSale cannot be found still occupies its position but adds to no SPG's
 *   weight, so its units go to the other SPGs on that line, not to no one. That is unreachable
 *   today: `SpgSale.salesmanId` is required and no path deletes a sale.
 *
 * `scope.storeIds` limits the reports read (an empty array reads none); omitted, every store is
 * read. Read-only.
 */
export async function getCommissionRecap(
  yearMonth: string,
  client: Client = prisma,
  scope: { storeIds?: string[] } = {},
): Promise<CommissionRecap> {
  if (!isYearMonth(yearMonth)) throw new SpgCommissionRateError("INVALID_MONTH", String(yearMonth));
  const [year, month] = yearMonth.split("-").map(Number);
  const { start, endExclusive } = getJakartaMonthBounds(year, month);
  const inMonth = { gte: start, lt: endExclusive };

  const reports = await client.konsiSellThrough.findMany({
    where: {
      ...(scope.storeIds !== undefined ? { storeId: { in: scope.storeIds } } : {}),
      OR: [
        { status: { in: ["APPROVED", "VOIDED"] }, approvedAt: inMonth },
        { status: "VOIDED", voidedAt: inMonth },
      ],
    },
    orderBy: [{ approvedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      docNo: true,
      storeId: true,
      baseline: true,
      approvedAt: true,
      voidedAt: true,
      spgSplitSnapshotAt: true,
      closingStocktakeId: true,
      previousId: true,
      lines: {
        orderBy: [{ itemId: "asc" }, { variantSku: "asc" }],
        select: {
          itemId: true,
          variantSku: true,
          posSoldQty: true,
          latePosSoldQty: true,
          billedQty: true,
          item: { select: { categoryId: true } },
        },
      },
    },
  });
  /* A baseline report confirms nothing, and a report with no approval time never earned, so neither needs its weights read. */
  const earning = reports.flatMap((r) => (!r.baseline && r.approvedAt ? [{ ...r, approvedAt: r.approvedAt }] : []));
  const snapshotted = earning.filter((r) => r.spgSplitSnapshotAt !== null);
  const legacy = earning.filter((r) => r.spgSplitSnapshotAt === null);

  /* Every snapshotted report's weights in one read, by report, then by line key. */
  const shares = snapshotted.length > 0
    ? await client.konsiSellThroughSpgShare.findMany({
        where: { sellThroughId: { in: snapshotted.map((r) => r.id) } },
        orderBy: [{ sellThroughId: "asc" }, { itemId: "asc" }, { variantSku: "asc" }, { share: "asc" }, { salesmanId: "asc" }],
        select: { sellThroughId: true, itemId: true, variantSku: true, salesmanId: true, units: true },
      })
    : [];
  const weightsByReport = new Map<string, Map<string, SpgPosQty[]>>();
  for (const share of shares) {
    const byKey = weightsByReport.get(share.sellThroughId) ?? new Map<string, SpgPosQty[]>();
    const key = lineKey(share.itemId, share.variantSku);
    const weights = byKey.get(key) ?? [];
    weights.push({ salesmanId: share.salesmanId, qty: share.units });
    byKey.set(key, weights);
    weightsByReport.set(share.sellThroughId, byKey);
  }

  const previousIds = Array.from(new Set(legacy.map((r) => r.previousId).filter((id): id is string => id !== null)));
  const previousRows = previousIds.length > 0
    ? await client.konsiSellThrough.findMany({
        where: { id: { in: previousIds } },
        select: {
          id: true,
          closingStocktakeId: true,
          previousId: true,
          spgSplitSnapshotAt: true,
          lines: { select: { itemId: true, variantSku: true, posSoldQty: true, latePosSoldQty: true } },
          spgShares: { where: { share: "OWN" }, select: { itemId: true, variantSku: true, salesmanId: true, units: true } },
        },
      })
    : [];
  const previousById = new Map(previousRows.map((p) => [p.id, p]));

  /* Only a previous report whose successor carried late POS units needs its own window re-read, and that needs ITS previous. */
  const lateCarriers = legacy.filter(
    (r) => r.previousId !== null && previousById.has(r.previousId) && r.lines.some((l) => l.latePosSoldQty.toNumber() > 0),
  );
  const beforePreviousIds = Array.from(
    new Set(
      lateCarriers
        .map((r) => previousById.get(r.previousId!)!.previousId)
        .filter((id): id is string => id !== null),
    ),
  );
  const beforePreviousRows = beforePreviousIds.length > 0
    ? await client.konsiSellThrough.findMany({ where: { id: { in: beforePreviousIds } }, select: { id: true, closingStocktakeId: true } })
    : [];
  const beforePreviousById = new Map(beforePreviousRows.map((p) => [p.id, p]));

  const windows = new Map<string, Promise<LedgerRow[]>>();
  const loadWindow = (storeId: string, report: ChainLink, previous: { id: string; closingStocktakeId: string } | null) => {
    let pending = windows.get(report.id);
    if (!pending) {
      pending = windowRows(client, storeId, report, previous);
      windows.set(report.id, pending);
    }
    return pending;
  };

  const loaded = await Promise.all(
    legacy.map(async (r) => {
      const previous = r.previousId ? previousById.get(r.previousId) ?? null : null;
      const own = await loadWindow(r.storeId, r, previous ? { id: previous.id, closingStocktakeId: previous.closingStocktakeId } : null);
      let late: LedgerRow[] = [];
      if (previous && lateCarriers.includes(r)) {
        const beforePrevious = previous.previousId ? beforePreviousById.get(previous.previousId) ?? null : null;
        late = await loadWindow(r.storeId, previous, beforePrevious);
      }
      return { report: r, previous, own, late };
    }),
  );

  const saleIds = spgSaleIdsOf(...loaded.flatMap((l) => [l.own, l.late]));
  const sales = saleIds.length > 0
    ? await client.spgSale.findMany({ where: { id: { in: saleIds } }, select: { id: true, salesmanId: true } })
    : [];
  const salesmanBySale = new Map(sales.map((s) => [s.id, s.salesmanId]));

  for (const { report, previous, own, late } of loaded) {
    const byKey = new Map<string, SpgPosQty[]>();
    const lineWeights = perSpgPosQtyForLines({
      lines: report.lines.map(splitLine),
      ownRows: own,
      previousRows: late,
      previousLines: (previous?.lines ?? []).map(splitLine),
      /**
       * A report without a marker normally follows a previous report without one. If it does not —
       * an older image approving after a newer one snapshotted its predecessor — its late share is
       * still cut against that snapshot, never positionally (see `split-weights.ts`).
       */
      previousOwnShares: previous?.spgSplitSnapshotAt ? previous.spgShares : null,
      salesmanBySale,
    });
    for (const w of lineWeights) byKey.set(lineKey(w.itemId, w.variantSku), [...w.own, ...w.late]);
    weightsByReport.set(report.id, byKey);
  }

  const commissionReports: CommissionReport[] = earning.map((report) => {
    const weights = weightsByReport.get(report.id);
    return {
      id: report.id,
      storeId: report.storeId,
      baseline: report.baseline,
      approvedAt: report.approvedAt,
      voidedAt: report.voidedAt,
      lines: report.lines.map((l) => ({
        itemId: l.itemId,
        variantSku: l.variantSku,
        categoryId: l.item.categoryId,
        posQty: l.posSoldQty.toNumber(),
        billedQty: l.billedQty.toNumber(),
        perSpgPosQty: weights?.get(lineKey(l.itemId, l.variantSku)) ?? [],
      })),
    };
  });

  const rates = await listRates(client);
  const summary = summariseRecap(computeCommissionEvents(commissionReports, rates), yearMonth);

  const salesmanIds = Array.from(new Set(summary.rows.map((r) => r.salesmanId)));
  const storeIds = Array.from(new Set(summary.events.map((e) => e.storeId)));
  const categoryIds = Array.from(
    new Set([...summary.detail, ...summary.noRate].map((r) => r.categoryId).filter((id): id is string => id !== null)),
  );
  const [users, stores, categories] = await Promise.all([
    client.user.findMany({ where: { id: { in: salesmanIds } }, select: { id: true, name: true, email: true } }),
    client.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true } }),
    client.itemCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } }),
  ]);
  const spgNames: Record<string, string> = Object.fromEntries(users.map((u) => [u.id, u.name ?? u.email]));
  const storeNames: Record<string, string> = Object.fromEntries(stores.map((s) => [s.id, s.name]));
  const categoryNames: Record<string, string> = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  const nameOf = (salesmanId: string) => spgNames[salesmanId] ?? salesmanId;
  const byName = (a: { salesmanId: string }, b: { salesmanId: string }) =>
    nameOf(a.salesmanId).localeCompare(nameOf(b.salesmanId)) || (a.salesmanId < b.salesmanId ? -1 : a.salesmanId > b.salesmanId ? 1 : 0);

  return {
    yearMonth,
    rows: [...summary.rows].sort(byName),
    detail: summary.detail,
    noRate: summary.noRate.map((r) => ({
      categoryId: r.categoryId,
      categoryName: r.categoryId === null ? null : categoryNames[r.categoryId] ?? null,
      pieces: r.pieces,
    })),
    events: summary.events,
    reportDocNos: Object.fromEntries(reports.map((r) => [r.id, r.docNo])),
    spgNames,
    storeNames,
    categoryNames,
  };
}
