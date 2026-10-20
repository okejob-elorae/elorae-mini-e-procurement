import { prisma, type Prisma } from "@elorae/db";
import { loadSellThroughInputs } from "@/lib/konsi-sell-through/window";
import { getJakartaMonthBounds } from "@/lib/planning/calculations";
import {
  computeCommissionEvents,
  summariseRecap,
  takeUnitsBySalesman,
  type CommissionEvent,
  type CommissionReport,
  type RecapDetailRow,
  type RecapRow,
  type SpgPosQty,
} from "./compute";
import { SpgCommissionRateError } from "./errors";
import { isYearMonth } from "./month";
import { listRates } from "./rates";

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

/* One SpgSale ledger row of a window, in the window's ledger order, before its sale is resolved to an SPG. */
type WindowSaleRow = { key: string; saleId: string; units: number };

const lineKey = (itemId: string, variantSku: string) => `${itemId}::${variantSku}`;

/* The units a line's own window contributed to its stored POS figure: the total minus what it carried in as late. */
const ownPosUnits = (line: { posSoldQty: Prisma.Decimal; latePosSoldQty: Prisma.Decimal }) =>
  Math.max(0, Math.round(line.posSoldQty.toNumber() - line.latePosSoldQty.toNumber()));

/**
 * The SpgSale rows in one report's ledger window, through the same `loadSellThroughInputs` the
 * report writer derives from, so the window — lower edge exclusive, store-scoped, boundary at the
 * closing stocktake's own rows — is never re-spelled here. A sale row's qty is negative; its units
 * are the opposite.
 */
async function windowSaleRows(
  client: Client,
  storeId: string,
  report: ChainLink,
  previous: { id: string; closingStocktakeId: string } | null,
): Promise<WindowSaleRow[]> {
  /* The base client carries every TransactionClient member; the helper is typed for a tx only because its writers call it inside one. */
  const inputs = await loadSellThroughInputs(client as Prisma.TransactionClient, {
    storeId,
    closingStocktakeId: report.closingStocktakeId,
    previous,
  });
  return inputs.rows
    .filter((r) => r.refType === "SpgSale" && r.qty < 0)
    .map((r) => ({ key: lineKey(r.itemId, r.variantSku), saleId: r.refId, units: -r.qty }));
}

/**
 * The SPG commission recap for one WIB month (see `compute.ts` for the rules).
 *
 * Loads every non-DRAFT, non-CANCELLED report with an event in the month: APPROVED or VOIDED with
 * `approvedAt` in it, or VOIDED with `voidedAt` in it. A report voided this month but approved
 * earlier is loaded for its reversal, which mirrors the earlier EARNED event; only the month's
 * events are summarised.
 *
 * The pieces a line confirms come from the line's STORED figures (`posSoldQty`, which already
 * includes `latePosSoldQty`, and `billedQty`), never from the live ledger. The live ledger supplies
 * only the per-SPG split key, by enumerating the SpgSale rows the report counted:
 *
 * - Its own window's share is the FIRST `posSoldQty − latePosSoldQty` units of the SpgSale rows in
 *   its window, in ledger order (`createdAt`, then id), re-read through `loadSellThroughInputs`.
 *   Rows beyond that are rows that committed after the report was approved (the boundary race),
 *   which its successor carried forward as late.
 * - Its late share (`latePosSoldQty`, carried from the previous report P) is the units right after
 *   P's own share in P's window: the next `latePosSoldQty` units after P's first
 *   `posSoldQty − latePosSoldQty`.
 *
 * A late row has no identity of its own — the carry-forward stores only a per-key difference and no
 * row records when it committed — so "the newest units are the late ones" is an attribution, not a
 * fact. What it guarantees is that a window's units are partitioned between the report and its
 * successor with nothing counted twice, so a late row cannot change the split of the month that
 * approved the earlier report. Units that committed after BOTH reports were approved fall outside
 * both shares, as they fell outside both bills. A sale row whose SpgSale is gone credits no one.
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
  /* A baseline report confirms nothing, and a report with no approval time never earned, so neither needs its window read. */
  const earning = reports.flatMap((r) => (!r.baseline && r.approvedAt ? [{ ...r, approvedAt: r.approvedAt }] : []));

  const previousIds = Array.from(new Set(earning.map((r) => r.previousId).filter((id): id is string => id !== null)));
  const previousRows = previousIds.length > 0
    ? await client.konsiSellThrough.findMany({
        where: { id: { in: previousIds } },
        select: {
          id: true,
          closingStocktakeId: true,
          previousId: true,
          lines: { select: { itemId: true, variantSku: true, posSoldQty: true, latePosSoldQty: true } },
        },
      })
    : [];
  const previousById = new Map(previousRows.map((p) => [p.id, p]));

  /* Only a previous report whose successor carried late POS units needs its own window re-read, and that needs ITS previous. */
  const lateCarriers = earning.filter(
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

  const windows = new Map<string, Promise<WindowSaleRow[]>>();
  const loadWindow = (storeId: string, report: ChainLink, previous: { id: string; closingStocktakeId: string } | null) => {
    let pending = windows.get(report.id);
    if (!pending) {
      pending = windowSaleRows(client, storeId, report, previous);
      windows.set(report.id, pending);
    }
    return pending;
  };

  const loaded = await Promise.all(
    earning.map(async (r) => {
      const previous = r.previousId ? previousById.get(r.previousId) ?? null : null;
      const own = await loadWindow(r.storeId, r, previous ? { id: previous.id, closingStocktakeId: previous.closingStocktakeId } : null);
      let late: WindowSaleRow[] = [];
      if (previous && lateCarriers.includes(r)) {
        const beforePrevious = previous.previousId ? beforePreviousById.get(previous.previousId) ?? null : null;
        late = await loadWindow(r.storeId, previous, beforePrevious);
      }
      return { report: r, previous, own, late };
    }),
  );

  const saleIds = Array.from(new Set(loaded.flatMap((l) => [...l.own, ...l.late].map((row) => row.saleId))));
  const sales = saleIds.length > 0
    ? await client.spgSale.findMany({ where: { id: { in: saleIds } }, select: { id: true, salesmanId: true } })
    : [];
  const salesmanBySale = new Map(sales.map((s) => [s.id, s.salesmanId]));

  const unitsByKey = (rows: WindowSaleRow[]) => {
    const byKey = new Map<string, Array<{ salesmanId: string | null; units: number }>>();
    for (const row of rows) {
      const list = byKey.get(row.key) ?? [];
      list.push({ salesmanId: salesmanBySale.get(row.saleId) ?? null, units: row.units });
      byKey.set(row.key, list);
    }
    return byKey;
  };

  const commissionReports: CommissionReport[] = loaded.map(({ report, previous, own, late }) => {
    const ownUnits = unitsByKey(own);
    const lateUnits = unitsByKey(late);
    const previousLines = new Map<string, StoredLine>((previous?.lines ?? []).map((l) => [lineKey(l.itemId, l.variantSku), l]));

    return {
      id: report.id,
      storeId: report.storeId,
      baseline: report.baseline,
      approvedAt: report.approvedAt,
      voidedAt: report.voidedAt,
      lines: report.lines.map((l) => {
        const key = lineKey(l.itemId, l.variantSku);
        const perSpgPosQty: SpgPosQty[] = takeUnitsBySalesman(ownUnits.get(key) ?? [], 0, ownPosUnits(l));
        const latePieces = Math.round(l.latePosSoldQty.toNumber());
        if (latePieces > 0) {
          const previousLine = previousLines.get(key);
          const skip = previousLine ? ownPosUnits(previousLine) : 0;
          perSpgPosQty.push(...takeUnitsBySalesman(lateUnits.get(key) ?? [], skip, latePieces));
        }
        return {
          itemId: l.itemId,
          variantSku: l.variantSku,
          categoryId: l.item.categoryId,
          posQty: l.posSoldQty.toNumber(),
          billedQty: l.billedQty.toNumber(),
          perSpgPosQty,
        };
      }),
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
