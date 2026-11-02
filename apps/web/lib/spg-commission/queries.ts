import { prisma, type Prisma } from "@elorae/db";
import { aturanLama } from "@/lib/spg/komisi";
import { alasanTahan, labelLaporanKomisi } from "@/lib/spg/koreksi";
import { koreksiBulanBayar, laporanKonsiTidakLengkap, siklusAturanLama } from "@/lib/spg/koreksi-queries";
import { REF_KOMISI_KONSI } from "@/lib/spg/hilang";
import { summariseRecap, type CommissionEvent, type RecapDetailRow } from "./compute";
import { SpgCommissionRateError } from "./errors";
import { commissionRates, lockedKonsiReports, putusPayoutReports, wibMonthRange } from "./laporan-queries";
import { isYearMonth } from "./month";
import { commissionPerSpg, salesMonthLabelId, salesReportEvents, type SalesReport } from "./payout";
import { payoutLinesOf, payoutTotalsBySpg, type PayoutLine, type PayoutReportInput } from "./recap-payout";

type Client = Prisma.TransactionClient | typeof prisma;

/**
 * One SPG's row in a payout month — every figure named for what it is (owner decision 2026-11-02):
 * the per-SPG figure today, what is stored, what was actually PAID, the corrections applied in this
 * payout month, what is not paid yet, and the difference that rides on her next payout. Nothing
 * unpaid is ever presented as paid.
 */
export type CommissionRecapRow = {
  salesmanId: string;
  storeIds: string[];
  /* The sales months her reports in this payout month come from, ascending. */
  salesMonths: string[];
  /* Her current confirmed pieces on those reports. */
  pieces: number;
  noRatePieces: number;
  /* Σ per-SPG figure today — what an unpaid row is paid at. */
  figure: number;
  /* Σ stored figures (gross of lost-goods deductions). */
  setAmount: number;
  /* Σ stored figures of her rows already marked paid. */
  paidAmount: number;
  /* Σ figure − corrections applied, over her unpaid and not-yet-set reports. */
  unpaidAmount: number;
  hasUnset: boolean;
  /* Σ corrections applied to her payouts in this payout month. */
  correctionsApplied: number;
  /* Σ difference on her closed reports (figure − paid − applied) waiting for her next payout. */
  pendingDifference: number;
  /* Some unpaid stored figure of hers is replaced by the per-SPG figure when paid. */
  differs: boolean;
};

/** One correction applied in the payout month (`SpgCommissionCorrection`). */
export type RecapCorrectionLine = {
  id: string;
  salesmanId: string;
  payoutMonth: string;
  sourceKey: string;
  sourceKind: "KONSI" | "PUTUS";
  sourceStoreId: string;
  sourceSalesMonth: string;
  /* The source report's printable number: the consignment number, or "Penjualan <bulan>". */
  sourceDocNo: string;
  amount: number;
  note: string;
  paidRefType: string;
  paidRefId: string;
  /* "Komisi penjualan <bulan> — <toko>" of the payout the correction rode on. */
  appliedToLabel: string;
  /* ISO instant. */
  appliedAt: string;
};

export type CommissionRecap = {
  /* The PAYOUT month: the WIB month the reports in it were checked. */
  yearMonth: string;
  rows: CommissionRecapRow[];
  /* One line per SPG per report. */
  payoutLines: PayoutLine[];
  /* Corrections applied in this payout month. */
  corrections: RecapCorrectionLine[];
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

const compareId = (a: string, b: string) => (a === b ? 0 : a < b ? -1 : 1);

/**
 * The SPG commission recap for one PAYOUT month (see `payout.ts` for the rules): every consignment
 * cycle locked in the month and every putus store × month paid in it — checked in it, or set under
 * the old rule in it without a check (`putusPayoutReports`, the same loader as Komisi SPG) — with
 * the sales month each comes from.
 *
 * Per SPG per report: the per-SPG figure today, the stored figure, what was paid, the corrections
 * already applied from the report, and the difference still waiting (`recap-payout.ts`); per SPG
 * the corrections applied in this payout month. Konsi sell-through reports are not read: decision 3
 * keeps consignment on the cycle, and reading both would count one month twice.
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

  const [konsi, putus, rates, correctionsInMonth] = await Promise.all([
    lockedKonsiReports(client, { lockedIn: range, storeIds: scope.storeIds }),
    putusPayoutReports(client, { paidIn: range, storeIds: scope.storeIds }),
    commissionRates(client),
    koreksiBulanBayar(client, yearMonth, scope.storeIds !== undefined ? { storeIds: scope.storeIds } : {}),
  ]);
  const reportKeys = [...konsi.map((k) => k.key), ...putus.map((p) => p.key)];
  const [konsiStored, oldRuleCycles, appliedRows] = await Promise.all([
    konsi.length
      ? client.consignmentCommission.findMany({
          where: { cycleId: { in: konsi.map((k) => k.cycleId) } },
          select: { cycleId: true, spgUserId: true, commission: true, paidAt: true },
        })
      : Promise.resolve([]),
    siklusAturanLama(client, konsi.map((k) => k.cycleId)),
    reportKeys.length
      ? client.spgCommissionCorrection.findMany({ where: { sourceKey: { in: reportKeys } }, select: { sourceKey: true, spgUserId: true, amount: true } })
      : Promise.resolve([]),
  ]);
  const applied = new Map<string, Map<string, number>>();
  for (const a of appliedRows) {
    const per = applied.get(a.sourceKey) ?? new Map<string, number>();
    per.set(a.spgUserId, Math.round((per.get(a.spgUserId) ?? 0) * 100 + Number(a.amount) * 100) / 100);
    applied.set(a.sourceKey, per);
  }

  const reports: SalesReport[] = [...konsi, ...putus];
  const summary = summariseRecap(salesReportEvents(reports, rates), yearMonth);

  // The same hold as Komisi SPG and the payment writers (`alasanTahan`, `unitKomisiSpg`): on a report
  // set or locked under the old rule, an SPG with pieces that have no category rate — or, konsi, a
  // cycle whose official figures were not all recorded on the phones — waits for an owner decision
  // and carries no difference, whether or not she has a row on it.
  const heldOf = (
    kind: "KONSI" | "PUTUS",
    reportOldRule: boolean,
    stored: ReadonlyArray<{ salesmanId: string; oldRule: boolean }>,
    computed: ReturnType<typeof commissionPerSpg>,
    incomplete: boolean,
  ) => {
    const byId = new Map(computed.map((c) => [c.salesmanId, c]));
    const storedById = new Map(stored.map((s) => [s.salesmanId, s]));
    const ids = new Set([...storedById.keys(), ...byId.keys()]);
    return new Set(
      [...ids].filter(
        (id) =>
          alasanTahan({
            jenis: kind,
            dasarLama: reportOldRule || (storedById.get(id)?.oldRule ?? false),
            potongTanpaTarif: byId.get(id)?.noRatePieces ?? 0,
            laporanTidakLengkap: incomplete,
          }) !== null,
      ),
    );
  };

  const inputs: PayoutReportInput[] = [
    ...konsi.map((k) => {
      const computed = commissionPerSpg(k, rates);
      const oldRule = oldRuleCycles.has(k.cycleId);
      const stored = konsiStored
        .filter((s) => s.cycleId === k.cycleId)
        .map((s) => ({ salesmanId: s.spgUserId, commission: Number(s.commission), pieces: null, oldRule, paid: s.paidAt !== null }));
      return {
        key: k.key,
        kind: "KONSI" as const,
        storeId: k.storeId,
        salesMonth: k.salesMonth,
        payoutMonth: yearMonth,
        closed: true,
        stored,
        computed,
        appliedBySalesman: applied.get(k.key) ?? new Map<string, number>(),
        heldSalesmen: heldOf("KONSI", oldRule, stored, computed, laporanKonsiTidakLengkap(k, computed)),
      };
    }),
    ...putus.map((p) => {
      const computed = commissionPerSpg(p, rates);
      // No stored row yet: the checked month is not set, so nothing of it is paid.
      const stored = p.stored.length
        ? p.stored.map((s) => ({
            salesmanId: s.userId,
            commission: s.commission,
            pieces: s.unitsSold,
            oldRule: aturanLama(s.basis),
            paid: s.paidAt !== null,
          }))
        : null;
      return {
        key: p.key,
        kind: "PUTUS" as const,
        storeId: p.storeId,
        salesMonth: p.salesMonth,
        payoutMonth: yearMonth,
        closed: p.stored.some((s) => s.paidAt !== null),
        stored,
        computed,
        appliedBySalesman: applied.get(p.key) ?? new Map<string, number>(),
        heldSalesmen: heldOf("PUTUS", (stored ?? []).some((s) => s.oldRule), stored ?? [], computed, false),
      };
    }),
  ];
  const payoutLines = payoutLinesOf(inputs);
  const totals = payoutTotalsBySpg(
    payoutLines,
    correctionsInMonth.map((c) => ({ salesmanId: c.spgUserId, amount: c.jumlah })),
  );

  // The payout each correction rode on: its row's report (store × sales month).
  const paidPutusIds = correctionsInMonth.filter((c) => c.paidRefType !== REF_KOMISI_KONSI).map((c) => c.paidRefId);
  const paidKonsiIds = correctionsInMonth.filter((c) => c.paidRefType === REF_KOMISI_KONSI).map((c) => c.paidRefId);
  const sourceCycleIds = correctionsInMonth.filter((c) => c.jenis === "KONSI").map((c) => c.sumber.replace(/^konsi:/, ""));
  const [paidPutus, paidKonsi, sourceCycles] = await Promise.all([
    paidPutusIds.length
      ? client.spgCommission.findMany({ where: { id: { in: paidPutusIds } }, select: { id: true, storeId: true, period: true } })
      : Promise.resolve([]),
    paidKonsiIds.length
      ? client.consignmentCommission.findMany({
          where: { id: { in: paidKonsiIds } },
          select: { id: true, cycle: { select: { storeId: true, periodYear: true, periodMonth: true } } },
        })
      : Promise.resolve([]),
    sourceCycleIds.length
      ? client.consignmentCycle.findMany({ where: { id: { in: sourceCycleIds } }, select: { id: true, noKonsi: true } })
      : Promise.resolve([]),
  ]);
  const noKonsiOf = new Map(sourceCycles.map((c) => [`konsi:${c.id}`, c.noKonsi]));
  const appliedTo = new Map<string, { storeId: string; salesMonth: string }>([
    ...paidPutus.map((r) => [r.id, { storeId: r.storeId, salesMonth: r.period }] as const),
    ...paidKonsi.map((r) => [r.id, { storeId: r.cycle.storeId, salesMonth: `${r.cycle.periodYear}-${String(r.cycle.periodMonth).padStart(2, "0")}` }] as const),
  ]);

  const linesBySpg = new Map<string, PayoutLine[]>();
  for (const line of payoutLines) linesBySpg.set(line.salesmanId, [...(linesBySpg.get(line.salesmanId) ?? []), line]);
  const salesmanIds = Array.from(new Set([...totals.keys(), ...summary.rows.map((r) => r.salesmanId)]));

  const storeIds = Array.from(
    new Set([
      ...summary.events.map((e) => e.storeId),
      ...payoutLines.map((l) => l.storeId),
      ...correctionsInMonth.map((c) => c.storeId),
      ...[...appliedTo.values()].map((a) => a.storeId),
    ]),
  );
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
    const lines = linesBySpg.get(salesmanId) ?? [];
    const t = totals.get(salesmanId);
    const cents = (f: (l: PayoutLine) => number) => lines.reduce((n, l) => n + f(l), 0);
    return {
      salesmanId,
      storeIds: Array.from(new Set(lines.map((l) => l.storeId))).sort(compareId),
      salesMonths: Array.from(new Set(lines.map((l) => l.salesMonth))).sort(),
      pieces: cents((l) => l.pieces),
      noRatePieces: cents((l) => l.noRatePieces),
      figure: t?.figure ?? 0,
      setAmount: t?.setAmount ?? 0,
      paidAmount: t?.paidAmount ?? 0,
      unpaidAmount: t?.unpaidAmount ?? 0,
      hasUnset: t?.hasUnset ?? false,
      correctionsApplied: t?.correctionsApplied ?? 0,
      pendingDifference: t?.pendingDifference ?? 0,
      differs: t?.differs ?? false,
    };
  });

  const corrections: RecapCorrectionLine[] = correctionsInMonth.map((c) => {
    const to = appliedTo.get(c.paidRefId);
    return {
      id: c.id,
      salesmanId: c.spgUserId,
      payoutMonth: c.payoutMonth,
      sourceKey: c.sumber,
      sourceKind: c.jenis,
      sourceStoreId: c.storeId,
      sourceSalesMonth: c.bulanJual,
      sourceDocNo: c.jenis === "KONSI" ? (noKonsiOf.get(c.sumber) ?? c.sumber) : `Penjualan ${salesMonthLabelId(c.bulanJual)}`,
      amount: c.jumlah,
      note: c.teks,
      paidRefType: c.paidRefType,
      paidRefId: c.paidRefId,
      appliedToLabel: to ? labelLaporanKomisi({ bulanJual: to.salesMonth, namaToko: storeName(to.storeId) }) : c.paidRefId,
      appliedAt: c.diterapkanPada.toISOString(),
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
    corrections: corrections.sort((a, b) => byName(a, b) || a.sourceSalesMonth.localeCompare(b.sourceSalesMonth)),
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
