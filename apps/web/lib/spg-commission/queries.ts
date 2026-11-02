import { prisma, type Prisma } from "@elorae/db";
import { summariseRecap, type CommissionEvent, type RecapDetailRow, type RecapRow } from "./compute";
import { SpgCommissionRateError } from "./errors";
import { commissionRates, checkedPutusReports, lockedKonsiReports, wibMonthRange } from "./laporan-queries";
import { isYearMonth } from "./month";
import { salesMonthLabelId, salesReportEvents, type SalesReport } from "./payout";

type Client = Prisma.TransactionClient | typeof prisma;

export type CommissionRecap = {
  /* The PAYOUT month: the WIB month the reports in it were checked. */
  yearMonth: string;
  rows: RecapRow[];
  detail: RecapDetailRow[];
  noRate: Array<{ categoryId: string | null; categoryName: string | null; pieces: number }>;
  /* The month's events, one per report × SPG × category, for a per-report export; each carries its report's `salesMonth`. */
  events: CommissionEvent[];
  /* Each report's printable number by report key (`event.sellThroughId`): the consignment number, or "Penjualan <bulan>" for a putus month. */
  reportDocNos: Record<string, string>;
  spgNames: Record<string, string>;
  storeNames: Record<string, string>;
  categoryNames: Record<string, string>;
};

/**
 * The SPG commission recap for one PAYOUT month (see `payout.ts` for the rules): every consignment
 * cycle locked in the month and every putus store × month checked in it, computed by the one
 * calculation — rate per item category in force in the sales month, pieces split by each SPG's
 * own sales. A report's events carry its sales month (`salesMonth`), so "Komisi penjualan Oktober
 * 2026" lands in November when October was checked in November.
 *
 * A reading: it recomputes from the reports' current inputs. What is paid is the figure stored
 * when the office set it (`ConsignmentCommission` at the cycle's lock, `SpgCommission` at
 * "Tetapkan"), which Komisi SPG compares against this reading. Konsi sell-through reports are not
 * read: decision 3 keeps consignment on the cycle, and reading both would count one month twice.
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
  const range = wibMonthRange(yearMonth);

  const [konsi, putus, rates] = await Promise.all([
    lockedKonsiReports(client, { lockedIn: range, storeIds: scope.storeIds }),
    checkedPutusReports(client, { checkedIn: range, storeIds: scope.storeIds }),
    commissionRates(client),
  ]);
  const reports: SalesReport[] = [...konsi, ...putus];
  const summary = summariseRecap(salesReportEvents(reports, rates), yearMonth);

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
    reportDocNos: Object.fromEntries([
      ...konsi.map((r) => [r.key, r.noKonsi] as const),
      ...putus.map((r) => [r.key, `Penjualan ${salesMonthLabelId(r.salesMonth)}`] as const),
    ]),
    spgNames,
    storeNames,
    categoryNames,
  };
}
