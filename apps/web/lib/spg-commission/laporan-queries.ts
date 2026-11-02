import { prisma, type Prisma } from "@elorae/db";
import type { CommissionRate } from "./compute";
import { isYearMonth } from "./month";
import { konsiReportKey, putusReportKey, type SalesReport, type SpgSaleMovement } from "./payout";
import { listRates } from "./rates";

/**
 * Loads the sales reports `payout.ts` computes SPG commission from: a consignment cycle once its
 * official figures are locked, a putus store's month once the office has checked it
 * (`SpgSalesCheck`), and the SPG sale movements behind both. Every caller — the office pages, the
 * SPG phone, the consignment lock, the putus "Tetapkan" — reads through here, so the figure each
 * one shows is the same.
 *
 * The client may be a transaction: the writers call these inside `runSerializable`, so what they
 * compute and what they write see one state.
 */

type Client = Prisma.TransactionClient | typeof prisma;

/** A WIB month as an instant range `[start, end)`. */
export function wibMonthRange(yearMonth: string): { start: Date; end: Date } {
  const [year, month] = yearMonth.split("-").map(Number);
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  return { start: new Date(`${yearMonth}-01T00:00:00+07:00`), end: new Date(`${next}-01T00:00:00+07:00`) };
}

const monthOf = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

/** Every category rate, as the computation reads them. */
export async function commissionRates(client: Client = prisma): Promise<CommissionRate[]> {
  return (await listRates(client)).map((r) => ({
    itemCategoryId: r.itemCategoryId,
    effectiveFrom: r.effectiveFrom,
    amountPerPiece: r.amountPerPiece,
  }));
}

/**
 * Every SPG sale line (+qty) and shopper-return line (−qty) of the given stores in one WIB month,
 * per store, each credited to the SPG who wrote the original note. A sale counts in the month of
 * its note and a return in the month of the return, so a month whose report was checked is not
 * changed by a return that comes later; a return of an earlier month's note only reduces the same
 * SPG's same item this month, never below zero (`toCommissionReport`). The category is the item's
 * category as it stands now.
 */
export async function spgSaleMovements(
  client: Client,
  storeIds: readonly string[],
  salesMonth: string,
): Promise<Map<string, SpgSaleMovement[]>> {
  const result = new Map<string, SpgSaleMovement[]>(storeIds.map((id) => [id, []]));
  if (storeIds.length === 0 || !isYearMonth(salesMonth)) return result;
  const { start, end } = wibMonthRange(salesMonth);
  const ids = [...new Set(storeIds)];
  const [sales, returns] = await Promise.all([
    client.spgSaleLine.findMany({
      where: { spgSale: { storeId: { in: ids }, createdAt: { gte: start, lt: end } } },
      select: {
        itemId: true,
        qty: true,
        item: { select: { categoryId: true } },
        spgSale: { select: { storeId: true, salesmanId: true } },
      },
    }),
    client.spgSaleReturnLine.findMany({
      where: { saleReturn: { storeId: { in: ids }, createdAt: { gte: start, lt: end } } },
      select: {
        itemId: true,
        qty: true,
        saleReturn: { select: { storeId: true } },
        saleLine: { select: { item: { select: { categoryId: true } }, spgSale: { select: { salesmanId: true } } } },
      },
    }),
  ]);
  for (const s of sales) {
    result.get(s.spgSale.storeId)?.push({ salesmanId: s.spgSale.salesmanId, itemId: s.itemId, categoryId: s.item.categoryId, qty: s.qty });
  }
  for (const r of returns) {
    result.get(r.saleReturn.storeId)?.push({
      salesmanId: r.saleLine.spgSale.salesmanId,
      itemId: r.itemId,
      categoryId: r.saleLine.item.categoryId,
      qty: -r.qty,
    });
  }
  return result;
}

/** Movements for several store × month pairs, one read per month. */
async function movementsFor(client: Client, pairs: ReadonlyArray<{ storeId: string; salesMonth: string }>) {
  const storesByMonth = new Map<string, Set<string>>();
  for (const p of pairs) {
    const set = storesByMonth.get(p.salesMonth) ?? new Set<string>();
    set.add(p.storeId);
    storesByMonth.set(p.salesMonth, set);
  }
  const loaded = await Promise.all(
    Array.from(storesByMonth, async ([salesMonth, stores]) => [salesMonth, await spgSaleMovements(client, [...stores], salesMonth)] as const),
  );
  const byMonth = new Map(loaded);
  return (storeId: string, salesMonth: string): SpgSaleMovement[] => byMonth.get(salesMonth)?.get(storeId) ?? [];
}

export type KonsiSalesReport = SalesReport & { kind: "KONSI"; cycleId: string; noKonsi: string };

/**
 * Consignment cycles whose official figures are locked, as sales reports: the cycle's month is the
 * sales month, its `lockedAt` the check, its `ConsignmentSold` lines the official count (a typed
 * line with no item counts for no SPG). `lockedIn` keeps the cycles locked in one payout month.
 */
export async function lockedKonsiReports(
  client: Client,
  where: { lockedIn?: { start: Date; end: Date }; cycleIds?: string[]; storeIds?: string[] } = {},
): Promise<KonsiSalesReport[]> {
  const cycles = await client.consignmentCycle.findMany({
    where: {
      lockedAt: where.lockedIn ? { gte: where.lockedIn.start, lt: where.lockedIn.end } : { not: null },
      ...(where.cycleIds !== undefined ? { id: { in: where.cycleIds } } : {}),
      ...(where.storeIds !== undefined ? { storeId: { in: where.storeIds } } : {}),
    },
    orderBy: [{ lockedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      noKonsi: true,
      storeId: true,
      periodYear: true,
      periodMonth: true,
      lockedAt: true,
      sold: { select: { itemId: true, qty: true } },
    },
  });
  const locked = cycles.flatMap((c) => (c.lockedAt ? [{ ...c, lockedAt: c.lockedAt }] : []));
  const movements = await movementsFor(
    client,
    locked.map((c) => ({ storeId: c.storeId, salesMonth: monthOf(c.periodYear, c.periodMonth) })),
  );
  return locked.map((c) => {
    const salesMonth = monthOf(c.periodYear, c.periodMonth);
    return {
      key: konsiReportKey(c.id),
      kind: "KONSI" as const,
      storeId: c.storeId,
      salesMonth,
      checkedAt: c.lockedAt,
      official: c.sold.flatMap((s) => (s.itemId ? [{ itemId: s.itemId, qty: s.qty }] : [])),
      movements: movements(c.storeId, salesMonth),
      cycleId: c.id,
      noKonsi: c.noKonsi,
    };
  });
}

export type PutusSalesReport = SalesReport & { kind: "PUTUS"; checkId: string; checkedById: string };

/**
 * Putus stores' months the office has checked (`SpgSalesCheck`), as sales reports. `checkedIn`
 * keeps the checks of one payout month; `storeId` + `period` reads one store × month.
 */
export async function checkedPutusReports(
  client: Client,
  where: { checkedIn?: { start: Date; end: Date }; storeIds?: string[]; period?: string } = {},
): Promise<PutusSalesReport[]> {
  const checks = await client.spgSalesCheck.findMany({
    where: {
      ...(where.checkedIn ? { checkedAt: { gte: where.checkedIn.start, lt: where.checkedIn.end } } : {}),
      ...(where.storeIds !== undefined ? { storeId: { in: where.storeIds } } : {}),
      ...(where.period !== undefined ? { period: where.period } : {}),
    },
    orderBy: [{ checkedAt: "asc" }, { id: "asc" }],
    select: { id: true, storeId: true, period: true, checkedAt: true, checkedById: true },
  });
  const movements = await movementsFor(client, checks.map((c) => ({ storeId: c.storeId, salesMonth: c.period })));
  return checks.map((c) => ({
    key: putusReportKey(c.storeId, c.period),
    kind: "PUTUS" as const,
    storeId: c.storeId,
    salesMonth: c.period,
    checkedAt: c.checkedAt,
    official: null,
    movements: movements(c.storeId, c.period),
    checkId: c.id,
    checkedById: c.checkedById,
  }));
}

/**
 * One putus store × month as a report, checked or not: the figures "Tandai laporan dicek" and
 * "Tetapkan" would see, and the estimate on the SPG phone. `checkedAt` is the check when there is
 * one, else the moment asked about.
 */
export async function putusReportOf(client: Client, storeId: string, salesMonth: string, checkedAt: Date): Promise<SalesReport> {
  const movements = await spgSaleMovements(client, [storeId], salesMonth);
  return {
    key: putusReportKey(storeId, salesMonth),
    kind: "PUTUS",
    storeId,
    salesMonth,
    checkedAt,
    official: null,
    movements: movements.get(storeId) ?? [],
  };
}

/**
 * Several putus store × month pairs as reports, checked or not, with one movement read per month;
 * returned in the order asked. Each pair's `checkedAt` is the check when there is one, else the
 * moment asked about — it only dates the report, never changes its pieces.
 */
export async function putusReportsOf(
  client: Client,
  pairs: ReadonlyArray<{ storeId: string; salesMonth: string; checkedAt: Date }>,
): Promise<SalesReport[]> {
  if (pairs.length === 0) return [];
  const movements = await movementsFor(client, pairs);
  return pairs.map((p) => ({
    key: putusReportKey(p.storeId, p.salesMonth),
    kind: "PUTUS" as const,
    storeId: p.storeId,
    salesMonth: p.salesMonth,
    checkedAt: p.checkedAt,
    official: null,
    movements: movements(p.storeId, p.salesMonth),
  }));
}

/** One stored `SpgCommission` row — the figure the office set with "Tetapkan", which is what is paid. */
export type StoredPutusCommission = {
  id: string;
  userId: string;
  storeId: string;
  period: string;
  unitsSold: number;
  /* Gross whole rupiah; what the SPG receives is `commission − deduction`. */
  commission: number;
  deduction: number;
  basis: string;
  lockedAt: Date;
  paidAt: Date | null;
  note: string | null;
};

export type PutusPayoutReport = SalesReport & {
  kind: "PUTUS";
  /* The check that puts the month in this payout month; null for a commission set under the old rule without one. */
  check: { id: string; checkedAt: Date; checkedById: string } | null;
  /* The month's stored rows; empty while a checked month is not set yet ("belum ditetapkan"). */
  stored: StoredPutusCommission[];
};

const pairKey = (storeId: string, period: string) => `${storeId}\u0000${period}`;

/**
 * Every putus store × sales month PAID in one payout month, with its stored `SpgCommission` rows:
 * each month checked in it (`SpgSalesCheck.checkedAt`), plus each commission set under the old
 * rule without a check in any month, which belongs to the payout month its rows were last set in
 * (`lockedAt`). Komisi SPG and the recap both read through here, so the two list the same months
 * with the same stored figures. `storeIds` limits the stores read (an empty array reads none).
 */
export async function putusPayoutReports(
  client: Client,
  where: { paidIn: { start: Date; end: Date }; storeIds?: string[] },
): Promise<PutusPayoutReport[]> {
  const { paidIn, storeIds } = where;
  const storeFilter = storeIds !== undefined ? { storeId: { in: storeIds } } : {};
  const [checked, setInMonth] = await Promise.all([
    checkedPutusReports(client, { checkedIn: paidIn, storeIds }),
    client.spgCommission.findMany({
      where: { lockedAt: { gte: paidIn.start, lt: paidIn.end }, ...storeFilter },
      select: { storeId: true, period: true },
    }),
  ]);

  const checkedPairs = new Set(checked.map((r) => pairKey(r.storeId, r.salesMonth)));
  const candidates = [
    ...new Map(setInMonth.map((r) => [pairKey(r.storeId, r.period), { storeId: r.storeId, period: r.period }])).values(),
  ].filter((p) => !checkedPairs.has(pairKey(p.storeId, p.period)));
  const checkedElsewhere = candidates.length
    ? await client.spgSalesCheck.findMany({
        where: { OR: candidates.map((p) => ({ storeId: p.storeId, period: p.period })) },
        select: { storeId: true, period: true },
      })
    : [];
  const elsewhere = new Set(checkedElsewhere.map((c) => pairKey(c.storeId, c.period)));
  const unchecked = candidates.filter((p) => !elsewhere.has(pairKey(p.storeId, p.period)));

  const pairs = [...checked.map((r) => ({ storeId: r.storeId, period: r.salesMonth })), ...unchecked];
  const rows = pairs.length
    ? await client.spgCommission.findMany({
        where: { OR: pairs.map((p) => ({ storeId: p.storeId, period: p.period })) },
        orderBy: [{ lockedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          userId: true,
          storeId: true,
          period: true,
          unitsSold: true,
          commission: true,
          deduction: true,
          basis: true,
          lockedAt: true,
          paidAt: true,
          note: true,
        },
      })
    : [];
  const storedByPair = new Map<string, StoredPutusCommission[]>();
  for (const r of rows) {
    const key = pairKey(r.storeId, r.period);
    storedByPair.set(key, [...(storedByPair.get(key) ?? []), { ...r, commission: Number(r.commission), deduction: Number(r.deduction) }]);
  }
  const storedOf = (storeId: string, period: string) => storedByPair.get(pairKey(storeId, period)) ?? [];

  // An old-rule month belongs to the payout month its rows were LAST set in — one month, never two.
  const oldRule = unchecked.flatMap((p) => {
    const lastSet = storedOf(p.storeId, p.period).reduce<Date | null>((t, r) => (t === null || r.lockedAt > t ? r.lockedAt : t), null);
    if (lastSet === null || lastSet < paidIn.start || lastSet >= paidIn.end) return [];
    return [{ storeId: p.storeId, salesMonth: p.period, checkedAt: lastSet }];
  });
  const oldRuleReports = await putusReportsOf(client, oldRule);

  return [
    ...checked.map(
      (r): PutusPayoutReport => ({
        key: r.key,
        kind: "PUTUS",
        storeId: r.storeId,
        salesMonth: r.salesMonth,
        checkedAt: r.checkedAt,
        official: null,
        movements: r.movements,
        check: { id: r.checkId, checkedAt: r.checkedAt, checkedById: r.checkedById },
        stored: storedOf(r.storeId, r.salesMonth),
      }),
    ),
    ...oldRuleReports.map((r): PutusPayoutReport => ({ ...r, kind: "PUTUS", check: null, stored: storedOf(r.storeId, r.salesMonth) })),
  ];
}
