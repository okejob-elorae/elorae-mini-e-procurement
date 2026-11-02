import { prisma, type Prisma } from "@elorae/db";
import { aturanLama } from "@/lib/spg/komisi";
import { summariseRecap, type CommissionEvent, type RecapDetailRow, type RecapRow } from "./compute";
import { SpgCommissionRateError } from "./errors";
import { commissionRates, lockedKonsiReports, putusPayoutReports, wibMonthRange } from "./laporan-queries";
import { isYearMonth } from "./month";
import { commissionPerSpg, salesMonthLabelId, salesReportEvents, type SalesReport } from "./payout";
import { payoutLinesOf, payoutTotalsBySpg, type PayoutLine, type PayoutReportInput } from "./recap-payout";

type Client = Prisma.TransactionClient | typeof prisma;

/**
 * One SPG's row in a payout month. The `RecapRow` totals (`pieces`, `earned`, `net`, …) are the
 * COMPUTATION over the reports' current inputs; the money that is paid is `setAmount`, the figure
 * stored when the office set it. An SPG appears when the computation credits her with a piece or a
 * stored row pays her a commission.
 */
export type CommissionRecapRow = RecapRow & {
  /* Σ stored figures: `ConsignmentCommission.commission` at a cycle's lock, `SpgCommission.commission` at "Tetapkan". Gross of lost-goods deductions. */
  setAmount: number;
  /* Σ computed figures of checked putus months not set yet ("belum ditetapkan"): paid only once set. */
  unsetAmount: number;
  hasUnset: boolean;
  /* Σ stored figures already marked paid. */
  paidAmount: number;
  /* Some report's stored figure for her disagrees with the computation, as Komisi SPG flags it. */
  differs: boolean;
};

export type CommissionRecap = {
  /* The PAYOUT month: the WIB month the reports in it were checked. */
  yearMonth: string;
  rows: CommissionRecapRow[];
  /* One line per SPG per report: stored figure, computed figure, status, difference. */
  payoutLines: PayoutLine[];
  /* The computation per SPG × category. */
  detail: RecapDetailRow[];
  noRate: Array<{ categoryId: string | null; categoryName: string | null; pieces: number }>;
  /* The computation's events, one per report × SPG × category, for a per-report export; each carries its report's `salesMonth`. */
  events: CommissionEvent[];
  /* Each report's printable number by report key (`event.sellThroughId`, `line.reportKey`): the consignment number, or "Penjualan <bulan>" for a putus month. */
  reportDocNos: Record<string, string>;
  spgNames: Record<string, string>;
  storeNames: Record<string, string>;
  categoryNames: Record<string, string>;
};

const emptyRow = (salesmanId: string): RecapRow => ({
  salesmanId,
  storeIds: [],
  pieces: 0,
  earned: 0,
  reversed: 0,
  net: 0,
  noRatePieces: 0,
});

const compareId = (a: string, b: string) => (a === b ? 0 : a < b ? -1 : 1);

/**
 * The SPG commission recap for one PAYOUT month (see `payout.ts` for the rules): every consignment
 * cycle locked in the month and every putus store × month paid in it — checked in it, or set under
 * the old rule in it without a check (`putusPayoutReports`, the same loader as Komisi SPG).
 *
 * The figure PAID is the one stored when the office set it — a cycle's `ConsignmentCommission` rows
 * at its lock, a putus month's `SpgCommission` rows at "Tetapkan" — read here, never recomputed, so
 * a month locked or set under the old rule, or before a late receipt or return synced, shows what
 * was actually set. The computation (category rate in force in the sales month × each SPG's own
 * pieces) runs beside it, per SPG and per category, and every disagreement is flagged
 * (`recap-payout.ts`). A checked putus month with no stored rows is "belum ditetapkan", its
 * computed figure counted apart, never as paid. Konsi sell-through reports are not read: decision
 * 3 keeps consignment on the cycle, and reading both would count one month twice.
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
    putusPayoutReports(client, { paidIn: range, storeIds: scope.storeIds }),
    commissionRates(client),
  ]);
  const konsiStored = konsi.length
    ? await client.consignmentCommission.findMany({
        where: { cycleId: { in: konsi.map((k) => k.cycleId) } },
        select: { cycleId: true, spgUserId: true, commission: true, paidAt: true },
      })
    : [];

  const reports: SalesReport[] = [...konsi, ...putus];
  const summary = summariseRecap(salesReportEvents(reports, rates), yearMonth);

  const inputs: PayoutReportInput[] = [
    ...konsi.map((k) => ({
      key: k.key,
      kind: "KONSI" as const,
      storeId: k.storeId,
      salesMonth: k.salesMonth,
      stored: konsiStored
        .filter((s) => s.cycleId === k.cycleId)
        .map((s) => ({ salesmanId: s.spgUserId, commission: Number(s.commission), pieces: null, oldRule: false, paid: s.paidAt !== null })),
      computed: commissionPerSpg(k, rates),
    })),
    ...putus.map((p) => ({
      key: p.key,
      kind: "PUTUS" as const,
      storeId: p.storeId,
      salesMonth: p.salesMonth,
      // No stored row yet: the checked month is not set, so nothing of it is paid.
      stored: p.stored.length
        ? p.stored.map((s) => ({
            salesmanId: s.userId,
            commission: s.commission,
            pieces: s.unitsSold,
            oldRule: aturanLama(s.basis),
            paid: s.paidAt !== null,
          }))
        : null,
      computed: commissionPerSpg(p, rates),
    })),
  ];
  const payoutLines = payoutLinesOf(inputs);
  const totals = payoutTotalsBySpg(payoutLines);

  const computedRows = new Map(summary.rows.map((r) => [r.salesmanId, r]));
  const storesOf = new Map<string, Set<string>>();
  for (const line of payoutLines) {
    const set = storesOf.get(line.salesmanId) ?? new Set<string>();
    set.add(line.storeId);
    storesOf.set(line.salesmanId, set);
  }
  const salesmanIds = Array.from(new Set([...computedRows.keys(), ...totals.keys()]));

  const storeIds = Array.from(new Set([...summary.events.map((e) => e.storeId), ...payoutLines.map((l) => l.storeId)]));
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
    nameOf(a.salesmanId).localeCompare(nameOf(b.salesmanId)) || compareId(a.salesmanId, b.salesmanId);
  const storeName = (id: string) => storeNames[id] ?? id;

  const rows: CommissionRecapRow[] = salesmanIds.map((salesmanId) => {
    const computed = computedRows.get(salesmanId) ?? emptyRow(salesmanId);
    const t = totals.get(salesmanId);
    return {
      ...computed,
      storeIds: Array.from(new Set([...computed.storeIds, ...(storesOf.get(salesmanId) ?? [])])).sort(compareId),
      setAmount: t?.setAmount ?? 0,
      unsetAmount: t?.unsetAmount ?? 0,
      hasUnset: t?.hasUnset ?? false,
      paidAmount: t?.paidAmount ?? 0,
      differs: t?.differs ?? false,
    };
  });

  return {
    yearMonth,
    rows: rows.sort(byName),
    payoutLines: [...payoutLines].sort(
      (a, b) =>
        a.salesMonth.localeCompare(b.salesMonth) ||
        storeName(a.storeId).localeCompare(storeName(b.storeId)) ||
        compareId(a.reportKey, b.reportKey) ||
        compareId(a.salesmanId, b.salesmanId),
    ),
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
