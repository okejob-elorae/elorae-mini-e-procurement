import { Prisma, prisma, sqlId } from "@elorae/db";
import { returPembeliBerlaku } from "@/lib/spg/retur-pembeli-berlaku";
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
 * Every SPG sale (+qty) and APPROVED shopper return (−qty) of the given stores' notes of one WIB
 * SALES month, per store, each credited to the SPG who wrote the original note.
 *
 * - A sale counts in the month of its note (`SpgSale.createdAt`).
 * - A shopper return counts in the month of its ORIGINAL note, whenever it was reported or approved
 *   (owner 2026-11-02, P9: "komisi di kurangi untuk bulan Oktober"), and only once the office has
 *   approved it (`returPembeliBerlaku`, the one spelling of "approved"): a reported return changes
 *   nothing until then, a rejected or withdrawn one never. When the original month is already
 *   paid, the difference reaches the SPG as a correction on her next payout (`lib/spg/koreksi.ts`),
 *   never by changing what was paid. Only COMMISSION reads returns this way — the store stock book,
 *   laku bersih and the day close still date a return at its report.
 * - The category is the one STORED ON THE LINE at sale time (`SpgSaleLine.categoryId`, P8), never
 *   the item's category now. A line sold with no category gets the item's category once, when the
 *   item first receives one (`isiKategoriPenjualanSpg`, P69); until then it earns nothing.
 *
 * Sales are read AGGREGATED per store × seller × item × line category in the database (one row
 * each, not one per line): the commission pages, the payment writers and the SPG phone all read
 * many store-months, and only these sums enter the computation. Returns are rare and read per line.
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
    client.$queryRaw<{ storeId: string; salesmanId: string; itemId: string; categoryId: string | null; qty: unknown }[]>(Prisma.sql`
      SELECT s.${sqlId("storeId")} AS ${sqlId("storeId")},
             s.${sqlId("salesmanId")} AS ${sqlId("salesmanId")},
             l.${sqlId("itemId")} AS ${sqlId("itemId")},
             l.${sqlId("categoryId")} AS ${sqlId("categoryId")},
             SUM(l.${sqlId("qty")}) AS ${sqlId("qty")}
      FROM ${sqlId("SpgSaleLine")} l
      JOIN ${sqlId("SpgSale")} s ON s.${sqlId("id")} = l.${sqlId("spgSaleId")}
      WHERE s.${sqlId("storeId")} IN (${Prisma.join(ids)})
        AND s.${sqlId("createdAt")} >= ${start} AND s.${sqlId("createdAt")} < ${end}
      GROUP BY s.${sqlId("storeId")}, s.${sqlId("salesmanId")}, l.${sqlId("itemId")}, l.${sqlId("categoryId")}
    `),
    client.spgSaleReturnLine.findMany({
      where: {
        saleReturn: returPembeliBerlaku({ storeId: { in: ids } }),
        saleLine: { spgSale: { createdAt: { gte: start, lt: end } } },
      },
      select: {
        itemId: true,
        qty: true,
        saleReturn: { select: { storeId: true } },
        saleLine: { select: { categoryId: true, spgSale: { select: { salesmanId: true } } } },
      },
    }),
  ]);
  for (const s of sales) {
    const qty = Number(s.qty ?? 0);
    if (!Number.isFinite(qty) || qty === 0) continue;
    result.get(s.storeId)?.push({ salesmanId: s.salesmanId, itemId: s.itemId, categoryId: s.categoryId ?? null, qty });
  }
  for (const r of returns) {
    result.get(r.saleReturn.storeId)?.push({
      salesmanId: r.saleLine.spgSale.salesmanId,
      itemId: r.itemId,
      categoryId: r.saleLine.categoryId ?? null,
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

export type KonsiSalesReport = SalesReport & {
  kind: "KONSI";
  cycleId: string;
  noKonsi: string;
  /* Σ qty of the official lines typed without an item: they count for no SPG. */
  officialItemlessQty: number;
};

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
  const itemlessQty = (sold: ReadonlyArray<{ itemId: string | null; qty: number }>) =>
    sold.reduce((n, s) => n + (s.itemId === null && Number.isFinite(s.qty) && s.qty > 0 ? s.qty : 0), 0);
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
      officialItemlessQty: itemlessQty(c.sold),
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
  /* Gross whole rupiah; what the SPG receives is `baseSalary + commission − deduction` (plus corrections). */
  commission: number;
  deduction: number;
  basis: string;
  /* Base salary snapshot (P63): putus SPGs are paid base salary through the system too. */
  baseSalary: number;
  lockedAt: Date;
  paidAt: Date | null;
  note: string | null;
};

export type PutusPayoutReport = SalesReport & {
  kind: "PUTUS";
  /* The check that puts the month in this payout month. */
  check: { id: string; checkedAt: Date; checkedById: string } | null;
  /* The month's stored rows; empty while a checked month is not set yet ("belum ditetapkan"). */
  stored: StoredPutusCommission[];
};

const pairKey = (storeId: string, period: string) => `${storeId}\u0000${period}`;

/**
 * Every putus store × sales month PAID in one payout month, with its stored `SpgCommission` rows:
 * each month checked in it (`SpgSalesCheck.checkedAt`). A putus row is payable only once its store
 * × month is checked (owner 2026-11-01, decision 7), so payout months come from checks alone —
 * the old-rule rows set without a check are gone with the old rule (no real SPG pay ever ran).
 * Komisi SPG and the recap both read through here, so the two list the same months with the same
 * stored figures. `storeIds` limits the stores read (an empty array reads none).
 */
export async function putusPayoutReports(
  client: Client,
  where: { paidIn: { start: Date; end: Date }; storeIds?: string[] },
): Promise<PutusPayoutReport[]> {
  const { paidIn, storeIds } = where;
  const checked = await checkedPutusReports(client, { checkedIn: paidIn, storeIds });
  const pairs = checked.map((r) => ({ storeId: r.storeId, period: r.salesMonth }));
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
          baseSalary: true,
          lockedAt: true,
          paidAt: true,
          note: true,
        },
      })
    : [];
  const storedByPair = new Map<string, StoredPutusCommission[]>();
  for (const r of rows) {
    const key = pairKey(r.storeId, r.period);
    storedByPair.set(key, [
      ...(storedByPair.get(key) ?? []),
      { ...r, commission: Number(r.commission), deduction: Number(r.deduction), baseSalary: Number(r.baseSalary) },
    ]);
  }
  const storedOf = (storeId: string, period: string) => storedByPair.get(pairKey(storeId, period)) ?? [];

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
  ];
}
